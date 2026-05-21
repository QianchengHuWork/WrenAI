import logging
import sys
from typing import Any, Literal

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.utils import loads_llm_json, trace_cost

logger = logging.getLogger("wren-ai-service")


class DenodoSubquerySpec(BaseModel):
    cte_name: str = Field(validation_alias=AliasChoices("cte_name", "cteName"))
    objective: str
    grain: str | None = None
    join_keys: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("join_keys", "joinKeys"),
    )
    output_columns: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("output_columns", "outputColumns"),
    )


class DenodoQueryDecompositionOutput(BaseModel):
    complexity: Literal["simple", "complex"]
    subqueries: list[DenodoSubquerySpec] = Field(default_factory=list)
    final_assembly: str = Field(
        default="",
        validation_alias=AliasChoices("final_assembly", "finalAssembly"),
    )


DENODO_QUERY_DECOMPOSITION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "denodo_query_decomposition",
            "schema": DenodoQueryDecompositionOutput.model_json_schema(),
        },
    }
}


denodo_query_decomposition_system_prompt = """
You are a senior analytics planner for Denodo text-to-SQL.

Return JSON only. Decide whether the user's question is simple or complex.

A question is complex when it requires multiple analytical grains, multiple
independent metrics that later need to be joined, top-N-per-group logic, ranking
combined with attributes, or multi-step intermediate aggregation. A question is
simple when one straightforward SELECT/GROUP BY query can answer it.

For complex questions, decompose the work into a small number of CTE-compatible
subqueries within the requested maximum. Each subquery must be independently
meaningful and have stable output columns. Do not write SQL here.

For "Top-N population first, then analyze monthly conversion/trend/decline"
questions, keep the Top-N population and monthly metric as separate subqueries,
then describe a final assembly that filters to the Top-N population before the
trend test. For continuous two-month decline, the plan must represent three consecutive months and two declines, not one previous-month comparison.
Use a self-join month adjacency plan with a YYYYMM month_index; do not plan
LAG/LEAD/window-function logic for consecutive months.
For relative YYYYMM windows, plan concrete lower/upper YYYYMM bounds from the
question/current time. Do not plan raw expressions like MAX(order_year_month) - 12.
"""


denodo_query_decomposition_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
{{ document }}
{% endfor %}

{% if instructions %}
### USER INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
{% endif %}

{% if semantic_context %}
### SEMANTIC DICTIONARY ###
{{ semantic_context }}
{% endif %}

{% if selected_models %}
### SELECTED MODELS ###
Primary Model: {{ selected_models.primary_model }}
Secondary Models: {{ selected_models.secondary_models | join(", ") if selected_models.secondary_models else "" }}
Needs Join: {{ selected_models.needs_join }}
{% endif %}

{% if matched_rewrites %}
### MATCHED REWRITES ###
{% for rewrite in matched_rewrites %}
- scope: {{ rewrite.scope.model }}.{{ rewrite.scope.column }} | user_phrase: {{ rewrite.user_phrase }} | canonical_value: {{ rewrite.canonical_value }}{% if rewrite.reason %} | reason: {{ rewrite.reason }}{% endif %}
{% endfor %}
{% endif %}

{% if sql_generation_reasoning %}
### EXISTING REASONING PLAN ###
{{ sql_generation_reasoning }}
{% endif %}

### USER QUESTION ###
Original User Question: {{ original_query }}
{% if normalized_query and normalized_query != original_query %}
Normalized User Question: {{ normalized_query }}
{% endif %}

### OUTPUT RULES ###
- Use `complexity: "simple"` when decomposition would not make the SQL easier.
- Use `complexity: "complex"` only when 2 to {{ max_subqueries }} subqueries can reduce SQL-generation difficulty.
- Each complex subquery must include `cte_name`, `objective`, `grain`, `join_keys`, and `output_columns`.
- `final_assembly` must describe how the final SQL should combine the subqueries.
- For city Top-N order amount plus conversion-rate consecutive-decline questions,
  include subquery intent for recent-period city order amount Top-N, monthly city
  conversion rate with `month_index`, and three-month self-join decline detection.
- For recent-period YYYYMM filters, describe concrete lower/upper bounds or
  month_index comparisons; never describe subtracting integers from MAX(YYYYMM).
- Do not include SQL in this response.
"""


def _normalize_subquery(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None

    try:
        spec = DenodoSubquerySpec.model_validate(raw)
    except Exception:
        return None

    cte_name = spec.cte_name.strip()
    objective = spec.objective.strip()
    if not cte_name or not objective:
        return None

    return {
        "cte_name": cte_name,
        "objective": objective,
        "grain": (spec.grain or "").strip(),
        "join_keys": [item.strip() for item in spec.join_keys if item.strip()],
        "output_columns": [
            item.strip() for item in spec.output_columns if item.strip()
        ],
    }


def normalize_denodo_query_decomposition(
    payload: Any,
    max_subqueries: int,
) -> dict:
    if not isinstance(payload, dict):
        return {
            "complexity": "simple",
            "subqueries": [],
            "final_assembly": "",
        }

    complexity = str(payload.get("complexity", "simple")).lower()
    if complexity != "complex":
        return {
            "complexity": "simple",
            "subqueries": [],
            "final_assembly": "",
        }

    subqueries = [
        normalized
        for normalized in (
            _normalize_subquery(item) for item in payload.get("subqueries", [])
        )
        if normalized
    ]
    if not 2 <= len(subqueries) <= max_subqueries:
        return {
            "complexity": "simple",
            "subqueries": [],
            "final_assembly": "",
        }

    final_assembly = str(
        payload.get("final_assembly") or payload.get("finalAssembly") or ""
    ).strip()
    return {
        "complexity": "complex",
        "subqueries": subqueries,
        "final_assembly": final_assembly,
    }


def format_validated_subquery_drafts(
    decomposition: dict,
    validated_drafts: list[dict],
) -> str:
    final_assembly = str(decomposition.get("final_assembly") or "").strip()
    lines = [
        "The following Denodo VQL subquery drafts are internal CTE-compatible guidance.",
        "They are not the final answer and the final single VQL query must still pass Denodo MCP validation.",
    ]
    if final_assembly:
        lines.extend(["", f"Final assembly: {final_assembly}"])

    for index, draft in enumerate(validated_drafts, start=1):
        spec = draft["subquery"]
        lines.extend(
            [
                "",
                f"Subquery {index}: {spec.get('cte_name')}",
                f"Objective: {spec.get('objective')}",
                f"Grain: {spec.get('grain') or ''}",
                f"Join keys: {', '.join(spec.get('join_keys') or [])}",
                f"Output columns: {', '.join(spec.get('output_columns') or [])}",
                "Internal VQL draft:",
                draft["sql"],
            ]
        )

    return "\n".join(lines).strip()


def format_query_decomposition_context(decomposition: dict) -> str:
    subqueries = decomposition.get("subqueries") or []
    if decomposition.get("complexity") != "complex" or not subqueries:
        return ""

    final_assembly = str(decomposition.get("final_assembly") or "").strip()
    lines = [
        "The Denodo question has already been decomposed into internal analytical subqueries.",
        "Use this plan to organize reasoning and preserve the listed grains, join keys, and outputs.",
    ]
    if final_assembly:
        lines.extend(["", f"Final assembly: {final_assembly}"])

    for index, subquery in enumerate(subqueries, start=1):
        lines.extend(
            [
                "",
                f"Subquery {index}: {subquery.get('cte_name')}",
                f"Objective: {subquery.get('objective')}",
                f"Grain: {subquery.get('grain') or ''}",
                f"Join keys: {', '.join(subquery.get('join_keys') or [])}",
                f"Output columns: {', '.join(subquery.get('output_columns') or [])}",
            ]
        )

    return "\n".join(lines).strip()


def construct_instruction_texts(instructions: list[Any] | None = None) -> list[str]:
    if not instructions:
        return []

    texts: list[str] = []
    for instruction in instructions:
        if isinstance(instruction, dict):
            text = str(instruction.get("instruction") or "").strip()
        else:
            text = str(instruction).strip()
        if text:
            texts.append(text)
    return texts


@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    prompt_builder: PromptBuilder,
    max_subqueries: int,
    instructions: list[Any] | None = None,
    semantic_context: str | None = None,
    sql_generation_reasoning: str | None = None,
    original_query: str | None = None,
    normalized_query: str | None = None,
    matched_rewrites: list[dict] | None = None,
    selected_models: dict | None = None,
) -> dict:
    prompt_result = prompt_builder.run(
        query=query,
        documents=documents,
        max_subqueries=max_subqueries,
        instructions=construct_instruction_texts(instructions),
        semantic_context=semantic_context or "",
        sql_generation_reasoning=sql_generation_reasoning or "",
        original_query=original_query or query,
        normalized_query=normalized_query or query,
        matched_rewrites=matched_rewrites or [],
        selected_models=selected_models,
    )
    return {"prompt": clean_up_new_lines(prompt_result.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def decompose_query(prompt: dict, generator: Any, generator_name: str) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
def post_process(decompose_query: dict, max_subqueries: int) -> dict:
    payload = loads_llm_json(decompose_query.get("replies")[0])
    return normalize_denodo_query_decomposition(payload, max_subqueries)


class DenodoQueryDecomposition(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=denodo_query_decomposition_system_prompt,
                generation_kwargs=DENODO_QUERY_DECOMPOSITION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=denodo_query_decomposition_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Denodo Query Decomposition")
    async def run(
        self,
        query: str,
        contexts: list[str],
        max_subqueries: int,
        instructions: list[Any] | None = None,
        semantic_context: str | None = None,
        sql_generation_reasoning: str | None = None,
        original_query: str | None = None,
        normalized_query: str | None = None,
        matched_rewrites: list[dict] | None = None,
        selected_models: dict | None = None,
    ):
        logger.info("Denodo Query Decomposition pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "max_subqueries": max_subqueries,
                "instructions": instructions or [],
                "semantic_context": semantic_context,
                "sql_generation_reasoning": sql_generation_reasoning,
                "original_query": original_query or query,
                "normalized_query": normalized_query or query,
                "matched_rewrites": matched_rewrites or [],
                "selected_models": selected_models,
                **self._components,
            },
        )
