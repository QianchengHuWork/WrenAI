import logging
import sys
from typing import Any

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.pipelines.common import clean_up_new_lines, retrieve_metadata
from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    SQLGenPostProcessor,
    construct_instructions,
    get_sql_generation_system_prompt,
)
from src.pipelines.generation.denodo_prompt_context import (
    build_denodo_vql_post_process_result,
    get_denodo_vql_generation_system_prompt,
    is_denodo_context,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


denodo_subquery_generation_user_prompt_template = """
### TASK ###
Generate one Denodo-compatible VQL draft for the specified subquery only.
The VQL must be a standalone SELECT and must also be safe to adapt into
a CTE in the final query.

### DATABASE SCHEMA ###
{% for document in documents %}
{{ document }}
{% endfor %}

{% if sql_functions %}
### SQL FUNCTIONS ###
{% for function in sql_functions %}
{{ function }}
{% endfor %}
{% endif %}

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

### ORIGINAL QUESTION ###
{{ original_query }}
{% if normalized_query and normalized_query != original_query %}

### NORMALIZED QUESTION ###
{{ normalized_query }}
{% endif %}

### FULL DECOMPOSITION PLAN ###
Final assembly: {{ final_assembly }}
{% for item in subqueries %}
- cte_name: {{ item.cte_name }}
  objective: {{ item.objective }}
  grain: {{ item.grain }}
  join_keys: {{ item.join_keys | join(", ") }}
  output_columns: {{ item.output_columns | join(", ") }}
{% endfor %}

### TARGET SUBQUERY ###
cte_name: {{ subquery.cte_name }}
objective: {{ subquery.objective }}
grain: {{ subquery.grain }}
join_keys: {{ subquery.join_keys | join(", ") }}
output_columns: {{ subquery.output_columns | join(", ") }}

### SUBQUERY RULES ###
- Generate only the target subquery VQL, not the final combined query.
- Keep output aliases stable and aligned with `output_columns`.
- Preserve the target grain exactly.
- Do not depend on temporary tables, previous subquery result rows, or user-visible intermediate data.
- Do not use LIMIT, FETCH, TOP, OFFSET, NULLS FIRST/LAST, or comments.
- Avoid ORDER BY unless it is required for a supported standalone semantic; final ordering belongs in the final SQL.
- If runtime metric formula instructions are present, use those formulas as the source of truth for metric expressions and forbidden patterns.
- `ptstart` and `ptend` are view-specific Denodo partition parameter columns. Add them only when the target view's retrieved schema explicitly contains both columns. Do not add `ptstart` or `ptend` to `dm_ord_month_city` unless that view's schema lists them. When used, write equality predicates only: `ptstart = '<start_yyyymmdd>' AND ptend = '<end_yyyymmdd>'`; never use <, <=, >, >=, or BETWEEN with them.
- Do not add/subtract integers directly from YYYYMM fields or `MAX(yyyymm)` subqueries. For relative windows, use concrete YYYYMM lower/upper bounds from the normalized question/current time, or compare derived `month_index` integers when dynamic arithmetic is required.
- If the target subquery defines an intermediate Top-N population for downstream joins, ORDER BY alone is not enough; use a Denodo-safe correlated-count filter with deterministic tie-break keys.
- Do not use LAG or LEAD for month-over-month or consecutive-month logic. Use a YYYYMM `month_index` expression and self joins for adjacent months.
- Only use views and columns from the database schema and selected models above; semantic/native mapping context cannot introduce extra views.

Let's think step by step.
"""


@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    prompt_builder: PromptBuilder,
    subquery: dict,
    subqueries: list[dict],
    final_assembly: str,
    instructions: list[dict] | None = None,
    semantic_context: str | None = None,
    sql_functions: list[SqlFunction] | None = None,
    sql_knowledge: SqlKnowledge | None = None,
    original_query: str | None = None,
    normalized_query: str | None = None,
    matched_rewrites: list[dict] | None = None,
    selected_models: dict | None = None,
) -> dict:
    prompt_result = prompt_builder.run(
        query=query,
        documents=documents,
        subquery=subquery,
        subqueries=subqueries,
        final_assembly=final_assembly,
        instructions=construct_instructions(instructions=instructions),
        semantic_context=semantic_context or "",
        sql_functions=sql_functions,
        sql_knowledge=sql_knowledge,
        original_query=original_query or query,
        normalized_query=normalized_query or query,
        matched_rewrites=matched_rewrites or [],
        selected_models=selected_models,
    )
    return {"prompt": clean_up_new_lines(prompt_result.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_subquery_sql(
    prompt: dict,
    generator: Any,
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
    semantic_context: str | None = None,
) -> dict:
    current_system_prompt = (
        get_denodo_vql_generation_system_prompt()
        if is_denodo_context(semantic_context)
        else get_sql_generation_system_prompt(sql_knowledge)
    )
    return await generator(
        prompt=prompt.get("prompt"),
        current_system_prompt=current_system_prompt,
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_subquery_sql: dict,
    post_processor: SQLGenPostProcessor,
    data_source: str,
    project_id: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = True,
    semantic_context: str | None = None,
) -> dict:
    if is_denodo_context(semantic_context):
        return build_denodo_vql_post_process_result(generate_subquery_sql.get("replies"))

    return await post_processor.run(
        generate_subquery_sql.get("replies"),
        project_id=project_id,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
    )


class DenodoSubqueryGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        document_store_provider: DocumentStoreProvider,
        engine: Engine,
        **kwargs,
    ):
        self._retriever = document_store_provider.get_retriever(
            document_store_provider.get_store("project_meta")
        )

        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=get_sql_generation_system_prompt(None),
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=denodo_subquery_generation_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Denodo Subquery Generation")
    async def run(
        self,
        query: str,
        contexts: list[str],
        subquery: dict,
        subqueries: list[dict],
        final_assembly: str,
        instructions: list[dict] | None = None,
        semantic_context: str | None = None,
        project_id: str | None = None,
        sql_functions: list[SqlFunction] | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        sql_knowledge: SqlKnowledge | None = None,
        original_query: str | None = None,
        normalized_query: str | None = None,
        matched_rewrites: list[dict] | None = None,
        selected_models: dict | None = None,
    ):
        logger.info("Denodo Subquery Generation pipeline is running...")
        if use_dry_plan:
            metadata = await retrieve_metadata(project_id or "", self._retriever)
        else:
            metadata = {}

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "subquery": subquery,
                "subqueries": subqueries,
                "final_assembly": final_assembly,
                "instructions": instructions,
                "semantic_context": semantic_context,
                "project_id": project_id,
                "sql_functions": sql_functions,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": metadata.get("data_source", "local_file"),
                "sql_knowledge": sql_knowledge,
                "original_query": original_query or query,
                "normalized_query": normalized_query or query,
                "matched_rewrites": matched_rewrites or [],
                "selected_models": selected_models,
                **self._components,
            },
        )
