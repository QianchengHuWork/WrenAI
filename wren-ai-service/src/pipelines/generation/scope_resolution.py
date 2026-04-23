import logging
import sys
from typing import Any, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.utils import loads_llm_json, trace_cost
from src.web.v1.services import Configuration
from src.web.v1.services.denodo_scope_normalization import (
    CandidateModelSummary,
    format_candidate_models,
    format_model_names,
    safe_log_value,
)

logger = logging.getLogger("wren-ai-service")


class ScopeResolutionOutput(BaseModel):
    primary_model: str
    secondary_models: list[str] = Field(default_factory=list)
    needs_join: bool = False
    reasoning: list[str] = Field(default_factory=list)


SCOPE_RESOLUTION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "scope_resolution",
            "schema": ScopeResolutionOutput.model_json_schema(),
        },
    }
}


scope_resolution_user_prompt_template = """
You are resolving the most likely semantic scope for a text-to-SQL request.

Rules:
1. Pick exactly one `primary_model`.
2. Only return `secondary_models` when the question clearly needs a join.
3. Prefer the smallest valid scope.
4. Use canonical mappings only as evidence for scope selection, not as SQL.
5. Return JSON only.

### USER QUESTION ###
{{ query }}

Language: {{ language }}
Current Time: {{ current_time }}

### CANDIDATE MODELS ###
{% for candidate in candidate_models %}
- model: {{ candidate.model }}
  {% if candidate.description %}description: {{ candidate.description }}{% endif %}
  {% if candidate.key_fields %}key_fields: {{ candidate.key_fields | join(", ") }}{% endif %}
  {% if candidate.normalizable_fields %}normalizable_fields: {{ candidate.normalizable_fields | join(", ") }}{% endif %}
  {% if candidate.available_canonical_mappings %}
  canonical_mappings:
  {% for mapping in candidate.available_canonical_mappings %}
  - {{ mapping }}
  {% endfor %}
  {% endif %}
  {% if candidate.field_descriptions %}
  field_descriptions:
  {% for field_description in candidate.field_descriptions %}
  - {{ field_description }}
  {% endfor %}
  {% endif %}
{% endfor %}
"""


@observe(capture_input=False)
def prompt(
    query: str,
    candidate_models: list[CandidateModelSummary],
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = Configuration(),
) -> dict:
    prompt_result = prompt_builder.run(
        query=query,
        candidate_models=[candidate.model_dump() for candidate in candidate_models],
        language=configuration.language,
        current_time=configuration.show_current_time(),
    )
    return {"prompt": clean_up_new_lines(prompt_result.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def resolve_scope(
    prompt: dict, generator: Any, generator_name: str
) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
def post_process(resolve_scope: dict) -> dict:
    return loads_llm_json(resolve_scope.get("replies")[0])


class ScopeResolution(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **_,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(template=scope_resolution_user_prompt_template),
            "generator": llm_provider.get_generator(
                generation_kwargs=SCOPE_RESOLUTION_MODEL_KWARGS
            ),
            "generator_name": llm_provider.get_model(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Scope Resolution")
    async def run(
        self,
        query: str,
        candidate_models: list[CandidateModelSummary],
        configuration: Optional[Configuration] = Configuration(),
    ):
        logger.info("Scope Resolution pipeline is running...")
        logger.info(
            "denodo_scope_resolution.input candidate_model_count=%s candidate_models=%s",
            len(candidate_models),
            format_candidate_models(candidate_models, limit=8),
        )
        result = await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "candidate_models": candidate_models,
                "configuration": configuration,
                **self._components,
            },
        )
        payload = result.get("post_process", {})
        logger.info(
            "denodo_scope_resolution.output primary_model=%s secondary_models=%s needs_join=%s",
            safe_log_value(payload.get("primary_model"), limit=80),
            format_model_names(
                payload.get("secondary_models", [])
                if isinstance(payload.get("secondary_models"), list)
                else [],
                limit=4,
            ),
            safe_log_value(payload.get("needs_join")),
        )
        return result
