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
    get_calculated_field_instructions,
    get_json_field_instructions,
    get_metric_instructions,
    get_sql_generation_system_prompt,
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


sql_generation_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if calculated_field_instructions %}
{{ calculated_field_instructions }}
{% endif %}

{% if metric_instructions %}
{{ metric_instructions }}
{% endif %}

{% if json_field_instructions %}
{{ json_field_instructions }}
{% endif %}

{% if sql_functions %}
### SQL FUNCTIONS ###
{% for function in sql_functions %}
{{ function }}
{% endfor %}
{% endif %}

{% if sql_samples %}
### SQL SAMPLES ###
{% for sample in sql_samples %}
Question:
{{sample.question}}
SQL:
{{sample.sql}}
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
{% if selected_models.reasoning %}
Selection Reasoning:
{% for item in selected_models.reasoning %}
- {{ item }}
{% endfor %}
{% endif %}
{% endif %}

{% if matched_rewrites %}
### MATCHED REWRITES ###
{% for rewrite in matched_rewrites %}
- scope: {{ rewrite.scope.model }}.{{ rewrite.scope.column }} | user_phrase: {{ rewrite.user_phrase }} | canonical_value: {{ rewrite.canonical_value }}{% if rewrite.reason %} | reason: {{ rewrite.reason }}{% endif %}
{% endfor %}
{% endif %}

### QUESTION ###
Original User Question: {{ original_query }}
{% if normalized_query and normalized_query != original_query %}
Normalized User Question: {{ normalized_query }}
{% endif %}

{% if sql_generation_reasoning %}
### REASONING PLAN ###
{{ sql_generation_reasoning }}
{% endif %}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    prompt_builder: PromptBuilder,
    sql_generation_reasoning: str | None = None,
    sql_samples: list[dict] | None = None,
    instructions: list[dict] | None = None,
    semantic_context: str | None = None,
    has_calculated_field: bool = False,
    has_metric: bool = False,
    has_json_field: bool = False,
    sql_functions: list[SqlFunction] | None = None,
    sql_knowledge: SqlKnowledge | None = None,
    original_query: str | None = None,
    normalized_query: str | None = None,
    matched_rewrites: list[dict] | None = None,
    selected_models: dict | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        documents=documents,
        sql_generation_reasoning=sql_generation_reasoning,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        semantic_context=semantic_context or "",
        calculated_field_instructions=(
            get_calculated_field_instructions(sql_knowledge)
            if has_calculated_field
            else ""
        ),
        metric_instructions=(
            get_metric_instructions(sql_knowledge) if has_metric else ""
        ),
        json_field_instructions=(
            get_json_field_instructions(sql_knowledge) if has_json_field else ""
        ),
        sql_samples=sql_samples,
        sql_functions=sql_functions,
        original_query=original_query or query,
        normalized_query=normalized_query or query,
        matched_rewrites=matched_rewrites or [],
        selected_models=selected_models,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql(
    prompt: dict,
    generator: Any,
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
) -> dict:
    current_system_prompt = get_sql_generation_system_prompt(sql_knowledge)
    return await generator(
        prompt=prompt.get("prompt"), current_system_prompt=current_system_prompt
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql: dict,
    post_processor: SQLGenPostProcessor,
    data_source: str,
    project_id: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = True,
    allow_data_preview: bool = False,
) -> dict:
    return await post_processor.run(
        generate_sql.get("replies"),
        project_id=project_id,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
        allow_data_preview=allow_data_preview,
    )


## End of Pipeline


class SQLGeneration(BasicPipeline):
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
                template=sql_generation_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Generation")
    async def run(
        self,
        query: str,
        contexts: list[str],
        sql_generation_reasoning: str | None = None,
        sql_samples: list[dict] | None = None,
        instructions: list[dict] | None = None,
        semantic_context: str | None = None,
        project_id: str | None = None,
        has_calculated_field: bool = False,
        has_metric: bool = False,
        has_json_field: bool = False,
        sql_functions: list[SqlFunction] | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        allow_data_preview: bool = False,
        sql_knowledge: SqlKnowledge | None = None,
        original_query: str | None = None,
        normalized_query: str | None = None,
        matched_rewrites: list[dict] | None = None,
        selected_models: dict | None = None,
    ):
        logger.info("SQL Generation pipeline is running...")
        has_normalization_context = bool(
            semantic_context
            or selected_models
            or (matched_rewrites or [])
            or (normalized_query or query) != (original_query or query)
        )
        if has_normalization_context:
            logger.info(
                "denodo_sql_generation.context project_id=%s selected_models=%s normalized_query_changed=%s normalized_query=%s rewrite_count=%s rewrites=%s",
                safe_log_value(project_id, limit=80),
                format_selected_models(selected_models),
                (normalized_query or query) != (original_query or query),
                safe_log_value(normalized_query or query),
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
                "query": query,
                "documents": contexts,
                "sql_generation_reasoning": sql_generation_reasoning,
                "sql_samples": sql_samples,
                "instructions": instructions,
                "semantic_context": semantic_context,
                "project_id": project_id,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "has_json_field": has_json_field,
                "sql_functions": sql_functions,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": metadata.get("data_source", "local_file"),
                "allow_data_preview": allow_data_preview,
                "sql_knowledge": sql_knowledge,
                "original_query": original_query or query,
                "normalized_query": normalized_query or query,
                "matched_rewrites": matched_rewrites or [],
                "selected_models": selected_models,
                **self._components,
            },
        )
