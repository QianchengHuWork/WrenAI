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
5. Decide the business domain from the user's words, then choose the model whose declared purpose and fields fit that domain. Metric formulas and canonical mappings are evidence only; they must not override the business domain.
6. For Denodo full-order questions about all orders, order date, order status, completed orders, order count, or order amount, prefer the full order fact scope: `primary_model = dv_ord_core`, `secondary_models = []`, and `needs_join = false` when `dv_ord_core` is a candidate. Do not choose `dv_assign_total_conversion_core` for ordinary all-order questions unless the user explicitly says smart assignment, assignment strategy, assigned leads, or post-assignment.
7. For Denodo option-package questions such as package popularity, option package order count, average extra package price, or package revenue, prefer `dv_package_order_core` when it is a candidate.
8. For Denodo city-level conversion-rate questions with monthly trend, month-over-month, or consecutive decline language, prefer the candidate that directly exposes city/month conversion fields such as `dv_clew_ord_conversion_core`. Do not use a strategy/month aggregate model unless the user asks about strategy or assignment strategy.
9. For questions that first select Top-N cities by order amount and then analyze conversion behavior, include the city order monthly aggregate such as `dm_ord_month_city` as a secondary model and set `needs_join` to true.
10. For Denodo all-leads, full-lead, lead-overview, lead-source, source-channel, source-catalog, or fourth-level source questions that ask for lead count, order count, large-deposit payment conversion rate, order conversion rate, refund-included conversion, or no-refund conversion, prefer the full lead-attribution scope: `primary_model = dv_clew_core`, `secondary_models = ["dv_ord_core"]`, and `needs_join = true` when both models are candidates. Do not choose `dv_assign_total_conversion_core` for these general lead conversion questions unless the user explicitly says smart assignment, assignment strategy, assigned leads, post-assignment, or asks by lead level. Do not use `assign_year_month` for all-leads questions. Do not substitute `dv_assign_total_conversion_core.channel_id` for a missing fourth-level source field; the source dimension must come from the lead-side candidate such as `dv_clew_core`.
11. For Denodo smart-assignment lead conversion metrics such as smart-assignment lead count, order count, conversion rate, converted order amount, or lead-level questions such as `线索等级`, `不同等级线索`, H/A/B/C lead levels, or `clew_level` with conversion rate/order count/output amount, prefer `dv_assign_total_conversion_core` when it is a candidate. Business chain: lead level -> smart assignment -> `dv_assign_total_conversion_core`. Assigned-store cross-region purchase questions such as `分配给门店`, `门店`, `fac_name`, `跨区购车`, `上牌城市≠交付城市`, or `is_cross_order` also belong to `dv_assign_total_conversion_core`; use `fac_name` as the store dimension and `is_cross_order = 1` as the cross-region flag. Do not choose `dv_clew_ord_conversion_core` or `dv_clew_assign_core` for these smart-assignment metrics when `dv_assign_total_conversion_core` is available. Do not route lead-level conversion/amount questions to `dv_clew_core` + `dv_ord_core` unless the user explicitly says full-lead overview, source attribution, fourth-level source, or line-clue overview.
12. The final selected scope is a hard SQL boundary: downstream SQL must not reference models outside `primary_model` and `secondary_models`.
13. Return JSON only.

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

### CANDIDATE METRIC FORMULA HINTS ###
These formulas are optional business-knowledge hints. Use them only as evidence
when their scope and business domain match the user's request; do not let a
formula override the candidate model whose declared purpose best fits the
question.
{% for formula in metric_formulas %}
- name: {{ formula.name }}
  primary_model: {{ formula.primary_model }}
  {% if formula.required_models %}required_models: {{ formula.required_models | join(", ") }}{% endif %}
  {% if formula.description %}description: {{ formula.description }}{% endif %}
  {% if formula.trigger_phrases %}trigger_phrases: {{ formula.trigger_phrases | join(", ") }}{% endif %}
  {% if formula.metric_names %}metrics: {{ formula.metric_names | join(", ") }}{% endif %}
{% endfor %}
"""


def _model_dump(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, dict):
        return value
    return {}


def _metric_formula_scope_hints(metric_formulas: list[Any] | None) -> list[dict]:
    hints: list[dict] = []
    for formula in metric_formulas or []:
        data = _model_dump(formula)
        enabled = data.get("enabled", True)
        data_source = data.get("data_source") or data.get("dataSource")
        if not enabled or str(data_source or "").lower() != "denodo":
            continue

        scope = _model_dump(data.get("scope"))
        match = _model_dump(data.get("match"))
        metrics = data.get("metrics") or []
        hints.append(
            {
                "name": data.get("name") or data.get("id") or "metric_formula",
                "description": data.get("description") or "",
                "primary_model": scope.get("primary_model")
                or scope.get("primaryModel")
                or "",
                "required_models": scope.get("required_models")
                or scope.get("requiredModels")
                or [],
                "trigger_phrases": match.get("trigger_phrases")
                or match.get("triggerPhrases")
                or [],
                "metric_names": [
                    _model_dump(metric).get("name")
                    for metric in metrics
                    if _model_dump(metric).get("name")
                ],
            }
        )
    return hints


@observe(capture_input=False)
def prompt(
    query: str,
    candidate_models: list[CandidateModelSummary],
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = Configuration(),
    metric_formulas: list[Any] | None = None,
) -> dict:
    prompt_result = prompt_builder.run(
        query=query,
        candidate_models=[candidate.model_dump() for candidate in candidate_models],
        metric_formulas=_metric_formula_scope_hints(metric_formulas),
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
        metric_formulas: Optional[list[Any]] = None,
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
                "metric_formulas": metric_formulas or [],
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
