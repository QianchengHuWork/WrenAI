import logging
import sys
from typing import Any, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.utils import loads_llm_json, trace_cost
from src.web.v1.services import Configuration
from src.web.v1.services.denodo_scope_normalization import (
    CandidateModelSummary,
    ScopedCanonicalValueDictionaryEntry,
    SelectedModels,
    format_rewrite_summaries,
    format_selected_models,
    safe_log_value,
)

logger = logging.getLogger("wren-ai-service")


class RewriteScope(BaseModel):
    model: str
    column: str


class QueryNormalizationMatch(BaseModel):
    scope: RewriteScope
    user_phrase: str
    canonical_value: str = Field(
        validation_alias=AliasChoices("canonical_value", "canonicalValue")
    )
    reason: str | None = None


class QueryNormalizationOutput(BaseModel):
    matched_rewrites: list[QueryNormalizationMatch] = Field(default_factory=list)
    normalized_query: str


QUERY_NORMALIZATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "query_normalization",
            "schema": QueryNormalizationOutput.model_json_schema(),
        },
    }
}


query_normalization_user_prompt_template = """
You are normalizing a natural-language analytical query with scoped canonical value dictionaries.

Rules:
1. Keep `normalized_query` as natural language.
2. Do not inject physical column names into `normalized_query`.
3. Only rewrite phrases when the canonical value is grounded in the provided scoped dictionaries.
4. Keep unrelated wording unchanged.
5. Return JSON only.

### USER QUESTION ###
{{ query }}

Language: {{ language }}
Current Time: {{ current_time }}

### SELECTED SCOPE ###
- primary_model: {{ selected_models.primary_model }}
- secondary_models: {{ selected_models.secondary_models | join(", ") if selected_models.secondary_models else "" }}
- needs_join: {{ selected_models.needs_join }}

### SELECTED MODEL SUMMARIES ###
{% for candidate in selected_candidate_models %}
- model: {{ candidate.model }}
  {% if candidate.description %}description: {{ candidate.description }}{% endif %}
  {% if candidate.field_descriptions %}
  field_descriptions:
  {% for field_description in candidate.field_descriptions %}
  - {{ field_description }}
  {% endfor %}
  {% endif %}
{% endfor %}

### SCOPED CANONICAL DICTIONARY ###
{% for entry in dictionary_entries %}
- scope: {{ entry.scope.model }}.{{ entry.scope.column }}
  canonical_value: {{ entry.canonical_value }}
  aliases: {{ entry.aliases | join(", ") }}
  {% if entry.description %}description: {{ entry.description }}{% endif %}
{% endfor %}
"""


@observe(capture_input=False)
def prompt(
    query: str,
    selected_models: SelectedModels,
    selected_candidate_models: list[CandidateModelSummary],
    dictionary_entries: list[ScopedCanonicalValueDictionaryEntry],
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = Configuration(),
) -> dict:
    prompt_result = prompt_builder.run(
        query=query,
        selected_models=selected_models.model_dump(),
        selected_candidate_models=[
            candidate.model_dump() for candidate in selected_candidate_models
        ],
        dictionary_entries=[entry.model_dump() for entry in dictionary_entries],
        language=configuration.language,
        current_time=configuration.show_current_time(),
    )
    return {"prompt": clean_up_new_lines(prompt_result.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def normalize_query(
    prompt: dict, generator: Any, generator_name: str
) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
def post_process(normalize_query: dict) -> dict:
    return loads_llm_json(normalize_query.get("replies")[0])


class QueryNormalization(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **_,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(
                template=query_normalization_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                generation_kwargs=QUERY_NORMALIZATION_MODEL_KWARGS
            ),
            "generator_name": llm_provider.get_model(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Query Normalization")
    async def run(
        self,
        query: str,
        selected_models: SelectedModels,
        selected_candidate_models: list[CandidateModelSummary],
        dictionary_entries: list[ScopedCanonicalValueDictionaryEntry],
        configuration: Optional[Configuration] = Configuration(),
    ):
        logger.info("Query Normalization pipeline is running...")
        logger.info(
            "denodo_query_normalization.input selected_models=%s candidate_model_count=%s dictionary_entry_count=%s",
            format_selected_models(selected_models),
            len(selected_candidate_models),
            len(dictionary_entries),
        )
        result = await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "selected_models": selected_models,
                "selected_candidate_models": selected_candidate_models,
                "dictionary_entries": dictionary_entries,
                "configuration": configuration,
                **self._components,
            },
        )
        payload = result.get("post_process", {})
        rewrites = (
            payload.get("matched_rewrites", [])
            if isinstance(payload, dict)
            and isinstance(payload.get("matched_rewrites"), list)
            else []
        )
        logger.info(
            "denodo_query_normalization.output normalized_query=%s rewrite_count=%s rewrites=%s",
            safe_log_value(
                payload.get("normalized_query") if isinstance(payload, dict) else None
            ),
            len(rewrites),
            format_rewrite_summaries(rewrites, limit=6),
        )
        return result
