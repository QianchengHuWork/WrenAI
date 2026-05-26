import logging
import sys
from typing import Any, Dict, List

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document
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
    get_text_to_sql_rules,
)
from src.pipelines.generation.denodo_prompt_context import (
    build_denodo_vql_post_process_result,
    get_denodo_vql_correction_system_prompt,
    is_denodo_context,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost
from src.web.v1.services.denodo_scope_normalization import (
    format_rewrite_summaries,
    format_selected_models,
    safe_log_value,
)

logger = logging.getLogger("wren-ai-service")


def get_sql_correction_system_prompt(sql_knowledge: SqlKnowledge | None = None) -> str:
    text_to_sql_rules = get_text_to_sql_rules(sql_knowledge)

    return f"""
### TASK ###
You are an ANSI SQL expert with exceptional logical thinking skills and debugging skills, you need to fix the syntactically incorrect ANSI SQL query.

### SQL CORRECTION INSTRUCTIONS ###

1. First, think hard about the error message, and figure out the root cause first(please use the DATABASE SCHEMA, SQL FUNCTIONS and USER INSTRUCTIONS to help you figure out the root cause).
2. Then, generate the syntactically correct ANSI SQL query to correct the error.

### SQL RULES ###
Make sure you follow the SQL Rules strictly.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be in JSON format:

{{
    "sql": <CORRECTED_SQL_QUERY_STRING>
}}
"""


sql_correction_user_prompt_template = """
{% if documents %}
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}
{% endif %}

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

{% if sql_samples %}
### SQL SAMPLES ###
{% for sample in sql_samples %}
Question: {{ sample.question }}
SQL: {{ sample.sql }}
{% endfor %}
{% endif %}

{% if validated_subquery_drafts %}
### INTERNAL DENODO VQL SUBQUERY DRAFTS ###
{{ validated_subquery_drafts }}

Use these VQL drafts as internal guidance when correcting the final query.
The corrected answer must still be one complete Denodo VQL query and will be validated as a whole by Denodo MCP.
{% endif %}

{% if hidden_sql_exemplar_context %}
{{ hidden_sql_exemplar_context }}
{% endif %}

{% if original_query %}
### ORIGINAL QUESTION ###
{{ original_query }}
{% endif %}

{% if normalized_query and normalized_query != original_query %}
### NORMALIZED QUESTION ###
{{ normalized_query }}
{% endif %}

### QUESTION ###
SQL: {{ invalid_generation_result.sql }}
Error Message: {{ invalid_generation_result.error }}

### DENODO-SPECIFIC FIX PRIORITIES ###
- If runtime metric formula instructions are present, use those formulas as the source of truth for metric expressions and forbidden patterns.
- If the error mentions `Function lag is not executable`, remove LAG/LEAD/window previous-row logic and rewrite consecutive-month comparisons as self joins over a YYYYMM `month_index`.
- If the error says a `ptstart` or `ptend` field is not found on a view, remove that partition predicate from that view. Only use `ptstart`/`ptend` on views whose retrieved schema explicitly includes both columns; for `dm_ord_month_city`, use `order_year_month` for month filtering unless its schema lists `ptstart` and `ptend`.
- If the invalid SQL uses <, <=, >, >=, or BETWEEN with `ptstart` or `ptend`, rewrite those predicates to equality boundaries: `ptstart = '<start_yyyymmdd>' AND ptend = '<end_yyyymmdd>'`.
- If the error mentions invalid `subtract` parameter types around `MAX(...year_month...)` or a YYYYMM field, remove raw YYYYMM arithmetic. Use concrete YYYYMM lower/upper bounds from the normalized question/current time, or derive month_index integers before arithmetic.
- If the error mentions `round(double precision, integer)`, remove FLOAT/DOUBLE casts from rounded rate, ratio, percentage, or conversion-rate expressions and preserve the runtime metric formula shape. Do not replace them with DECIMAL casts by default.
- If the invalid SQL uses ORDER BY only for an intermediate Top-N CTE that is later joined or filtered, add a real correlated-count Top-N filter with deterministic tie-break fields instead of LIMIT/FETCH/TOP.
- Keep corrected Denodo VQL within the selected models/retrieved schema above; do not introduce unselected views from broader semantic/native mapping text.

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: List[Document],
    invalid_generation_result: Dict,
    prompt_builder: PromptBuilder,
    instructions: list[dict] | None = None,
    sql_samples: list[dict] | None = None,
    sql_functions: list[SqlFunction] | None = None,
    semantic_context: str | None = None,
    original_query: str | None = None,
    normalized_query: str | None = None,
    matched_rewrites: list[dict] | None = None,
    selected_models: dict | None = None,
    validated_subquery_drafts: str | None = None,
    hidden_sql_exemplar_context: str | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        documents=documents,
        invalid_generation_result=invalid_generation_result,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        semantic_context=semantic_context or "",
        sql_samples=sql_samples,
        sql_functions=sql_functions,
        original_query=original_query,
        normalized_query=normalized_query,
        matched_rewrites=matched_rewrites or [],
        selected_models=selected_models,
        validated_subquery_drafts=validated_subquery_drafts or "",
        hidden_sql_exemplar_context=hidden_sql_exemplar_context or "",
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql_correction(
    prompt: dict,
    generator: Any,
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
    semantic_context: str | None = None,
) -> dict:
    current_system_prompt = (
        get_denodo_vql_correction_system_prompt()
        if is_denodo_context(semantic_context)
        else get_sql_correction_system_prompt(sql_knowledge)
    )
    return await generator(
        prompt=prompt.get("prompt"), current_system_prompt=current_system_prompt
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql_correction: dict,
    post_processor: SQLGenPostProcessor,
    data_source: str,
    project_id: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = True,
    validation_mode: str = "engine",
    semantic_context: str | None = None,
) -> dict:
    if validation_mode == "none" or is_denodo_context(semantic_context):
        return build_denodo_vql_post_process_result(
            generate_sql_correction.get("replies")
        )

    return await post_processor.run(
        generate_sql_correction.get("replies"),
        project_id=project_id,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
    )


## End of Pipeline


class SQLCorrection(BasicPipeline):
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
                system_prompt=get_sql_correction_system_prompt(None),
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_correction_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Correction")
    async def run(
        self,
        contexts: List[Document],
        invalid_generation_result: Dict[str, str],
        instructions: list[dict] | None = None,
        sql_samples: list[dict] | None = None,
        sql_functions: list[SqlFunction] | None = None,
        semantic_context: str | None = None,
        project_id: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        validation_mode: str = "engine",
        sql_knowledge: SqlKnowledge | None = None,
        original_query: str | None = None,
        normalized_query: str | None = None,
        matched_rewrites: list[dict] | None = None,
        selected_models: dict | None = None,
        validated_subquery_drafts: str | None = None,
        hidden_sql_exemplar_context: str | None = None,
    ):
        logger.info("SQLCorrection pipeline is running...")
        has_normalization_context = bool(
            semantic_context
            or selected_models
            or (matched_rewrites or [])
            or (normalized_query or "") != (original_query or "")
        )
        if has_normalization_context:
            logger.info(
                "denodo_sql_correction.context project_id=%s selected_models=%s normalized_query=%s rewrite_count=%s rewrites=%s",
                safe_log_value(project_id, limit=80),
                format_selected_models(selected_models),
                safe_log_value(normalized_query or original_query),
                len(matched_rewrites or []),
                format_rewrite_summaries(matched_rewrites or [], limit=6),
            )

        if use_dry_plan:
            metadata = await retrieve_metadata(project_id or "", self._retriever)
        else:
            metadata = {}

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "invalid_generation_result": invalid_generation_result,
                "documents": contexts,
                "instructions": instructions,
                "semantic_context": semantic_context,
                "sql_samples": sql_samples,
                "sql_functions": sql_functions,
                "project_id": project_id,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "validation_mode": validation_mode,
                "data_source": metadata.get("data_source", "local_file"),
                "sql_knowledge": sql_knowledge,
                "original_query": original_query,
                "normalized_query": normalized_query,
                "matched_rewrites": matched_rewrites or [],
                "selected_models": selected_models,
                "validated_subquery_drafts": validated_subquery_drafts,
                "hidden_sql_exemplar_context": hidden_sql_exemplar_context,
                **self._components,
            },
        )
