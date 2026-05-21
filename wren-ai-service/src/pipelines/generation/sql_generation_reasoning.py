import asyncio
import logging
import sys
from typing import Any, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.pipelines.generation.utils.sql import (
    construct_instructions,
    sql_generation_reasoning_system_prompt,
)
from src.utils import trace_cost
from src.web.v1.services import Configuration
from src.web.v1.services.denodo_scope_normalization import (
    format_rewrite_summaries,
    format_selected_models,
    safe_log_value,
)

logger = logging.getLogger("wren-ai-service")


sql_generation_reasoning_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if semantic_context %}
### SEMANTIC CONTEXT ###
{{ semantic_context }}
{% endif %}

{% if sql_samples %}
### SQL SAMPLES ###
{% for sql_sample in sql_samples %}
Question:
{{sql_sample.question}}
SQL:
{{sql_sample.sql}}
{% endfor %}
{% endif %}

{% if instructions %}
### USER INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
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

{% if query_decomposition_context %}
### QUERY DECOMPOSITION ###
{{ query_decomposition_context }}
{% endif %}

### INPUTS ###
Original User Question: {{ original_query }}
{% if normalized_query and normalized_query != original_query %}
Normalized User Question: {{ normalized_query }}
{% endif %}
Language: {{ language }}
Current Time: {{ current_time }}

### DENODO PLANNING CONSTRAINTS ###
- If selected models are present, reason only over those selected models and the retrieved schema.
- Treat `ptstart` and `ptend` as view-specific. Plan them only for views whose retrieved schema explicitly includes both columns; for `dm_ord_month_city`, plan month filtering with `order_year_month` unless its schema lists `ptstart` and `ptend`.
- For YYYYMM fields, do not plan expressions like `MAX(order_year_month) - 12`. Use concrete YYYYMM bounds for relative windows, or derive `month_index` before month arithmetic.
- For intermediate Top-N sets that feed later joins/filters, plan a true Top-N filter instead of relying on final ORDER BY.
- For continuous two-month decline, plan three consecutive month rows and two decreases using YYYYMM month_index self joins, not LAG/LEAD.

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    sql_samples: list[dict],
    instructions: list[dict],
    semantic_context: str | None,
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = Configuration(),
    original_query: str | None = None,
    normalized_query: str | None = None,
    matched_rewrites: list[dict] | None = None,
    selected_models: dict | None = None,
    query_decomposition_context: str | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        documents=documents,
        sql_samples=sql_samples,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        semantic_context=semantic_context or "",
        original_query=original_query or query,
        normalized_query=normalized_query or query,
        matched_rewrites=matched_rewrites or [],
        selected_models=selected_models,
        query_decomposition_context=query_decomposition_context or "",
        language=configuration.language,
        current_time=configuration.show_current_time(),
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql_reasoning(
    prompt: dict, generator: Any, query_id: str, generator_name: str
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"), query_id=query_id
    ), generator_name


@observe()
def post_process(
    generate_sql_reasoning: dict,
) -> dict:
    return generate_sql_reasoning.get("replies")[0]


## End of Pipeline


class SQLGenerationReasoning(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_reasoning_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_generation_reasoning_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def _streaming_callback(self, chunk, query_id):
        if query_id not in self._user_queues:
            self._user_queues[query_id] = asyncio.Queue()

        # Put the chunk content into the user's queue
        asyncio.create_task(self._user_queues[query_id].put(chunk.content))
        if chunk.meta.get("finish_reason"):
            asyncio.create_task(self._user_queues[query_id].put("<DONE>"))

    async def get_streaming_results(self, query_id):
        async def _get_streaming_results(query_id):
            return await self._user_queues[query_id].get()

        if query_id not in self._user_queues:
            self._user_queues[query_id] = asyncio.Queue()

        while True:
            try:
                # Wait for an item from the user's queue
                self._streaming_results = await asyncio.wait_for(
                    _get_streaming_results(query_id), timeout=120
                )
                if (
                    self._streaming_results == "<DONE>"
                ):  # Check for end-of-stream signal
                    del self._user_queues[query_id]
                    break
                if self._streaming_results:  # Check if there are results to yield
                    yield self._streaming_results
                    self._streaming_results = ""  # Clear after yielding
            except TimeoutError:
                break

    @observe(name="SQL Generation Reasoning")
    async def run(
        self,
        query: str,
        contexts: list[str],
        sql_samples: Optional[list[dict]] = None,
        instructions: Optional[list[str]] = None,
        semantic_context: str | None = None,
        configuration: Configuration = Configuration(),
        query_id: Optional[str] = None,
        original_query: str | None = None,
        normalized_query: str | None = None,
        matched_rewrites: list[dict] | None = None,
        selected_models: dict | None = None,
        query_decomposition_context: str | None = None,
    ):
        logger.info("SQL Generation Reasoning pipeline is running...")
        has_normalization_context = bool(
            semantic_context
            or selected_models
            or (matched_rewrites or [])
            or (normalized_query or query) != (original_query or query)
        )
        if has_normalization_context:
            logger.info(
                "denodo_sql_generation_reasoning.context query_id=%s selected_models=%s normalized_query_changed=%s normalized_query=%s rewrite_count=%s rewrites=%s",
                safe_log_value(query_id, limit=80),
                format_selected_models(selected_models),
                (normalized_query or query) != (original_query or query),
                safe_log_value(normalized_query or query),
                len(matched_rewrites or []),
                format_rewrite_summaries(matched_rewrites or [], limit=6),
            )
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "sql_samples": sql_samples or [],
                "instructions": instructions or [],
                "semantic_context": semantic_context,
                "configuration": configuration,
                "query_id": query_id,
                "original_query": original_query or query,
                "normalized_query": normalized_query or query,
                "matched_rewrites": matched_rewrites or [],
                "selected_models": selected_models,
                "query_decomposition_context": query_decomposition_context,
                **self._components,
            },
        )
