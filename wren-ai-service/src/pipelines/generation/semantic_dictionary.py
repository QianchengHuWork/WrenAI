import logging
import sys
from typing import Any

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.utils import loads_llm_json, trace_cost

logger = logging.getLogger("wren-ai-service")


class SemanticDictionaryTaskScope(BaseModel):
    model: str
    column: str


class SemanticDictionaryTask(BaseModel):
    taskId: str
    scope: SemanticDictionaryTaskScope
    rewriteMode: str
    columnType: str | None = None
    description: str | None = None
    modelDescription: str | None = None


class SemanticDictionaryValueMapping(BaseModel):
    canonicalValue: str
    aliases: list[str] = Field(default_factory=list)
    description: str | None = None


class SemanticDictionaryBatchItem(BaseModel):
    taskId: str
    concept: str | None = None
    description: str | None = None
    aliases: list[str] = Field(default_factory=list)
    valueMappings: list[SemanticDictionaryValueMapping] = Field(default_factory=list)


class SemanticDictionaryBatchResult(BaseModel):
    items: list[SemanticDictionaryBatchItem] = Field(default_factory=list)


SEMANTIC_DICTIONARY_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "semantic_dictionary_batch",
            "schema": SemanticDictionaryBatchResult.model_json_schema(),
        },
    }
}

system_prompt = """
You fill semantic dictionary tasks for a BI semantic layer.

Return JSON only. Do not return prose.

Rules:
1. Only fill tasks listed in the input.
2. Every output item must include taskId from the input.
3. For rewriteMode = "COLUMN_HINT":
   - provide a short concept
   - provide a concise description when helpful
   - provide user-facing aliases or synonyms
4. For rewriteMode = "VALUE_ALIAS":
   - provide concept and description when helpful
   - provide valueMappings as a list of canonicalValue + aliases
   - canonicalValue must be an exact database-side value only when clearly grounded in the input
5. If a task is uncertain, omit it instead of guessing.
6. Do not invent relationships, joins, measures, or values not grounded in the input descriptions.
"""

user_prompt_template = """
Language: {{ language }}

### TASKS TO FILL ###
{% for task in tasks %}
- taskId: {{ task.taskId }}
  scope: {{ task.scope.model }}.{{ task.scope.column }}
  rewriteMode: {{ task.rewriteMode }}
  {% if task.columnType %}columnType: {{ task.columnType }}{% endif %}
  {% if task.description %}columnDescription: {{ task.description }}{% endif %}
  {% if task.modelDescription %}modelDescription: {{ task.modelDescription }}{% endif %}
{% endfor %}

### RELEVANT SEMANTIC MODELS ###
{% for model in manifest_summary.models %}
- model: {{ model.name }}
  {% if model.description %}description: {{ model.description }}{% endif %}
  columns:
  {% for column in model.columns %}
  - name: {{ column.name }}
    type: {{ column.type }}
    {% if column.description %}description: {{ column.description }}{% endif %}
  {% endfor %}
{% endfor %}

### RELEVANT RAW SCHEMA SNAPSHOT ###
{% for view in raw_schema_summary.views %}
- view: {{ view.view_name }}
  {% if view.description %}description: {{ view.description }}{% endif %}
  columns:
  {% for column in view.columns %}
  - name: {{ column.name }}
    type: {{ column.data_type }}
    {% if column.description %}description: {{ column.description }}{% endif %}
  {% endfor %}
{% endfor %}

Return JSON in this shape:
{
  "items": [
    {
      "taskId": "task id from input",
      "concept": "short concept",
      "description": "optional short explanation",
      "aliases": ["alias 1", "alias 2"],
      "valueMappings": [
        {
          "canonicalValue": "exact database value",
          "aliases": ["user alias 1", "user alias 2"],
          "description": "optional mapping note"
        }
      ]
    }
  ]
}
"""


@observe(capture_input=False)
def cleaned_inputs(
    tasks: list[dict],
    manifest_summary: dict,
    raw_schema_summary: dict,
) -> dict:
    cleaned = {
        "tasks": tasks or [],
        "manifest_summary": manifest_summary or {"models": []},
        "raw_schema_summary": raw_schema_summary or {"views": []},
    }
    logger.info(
        "Semantic Dictionary batch input: tasks=%s models=%s views=%s",
        len(cleaned["tasks"]),
        len(cleaned["manifest_summary"].get("models", [])),
        len(cleaned["raw_schema_summary"].get("views", [])),
    )
    return cleaned


@observe(capture_input=False)
def prompt(
    cleaned_inputs: dict,
    prompt_builder: PromptBuilder,
    language: str,
) -> dict:
    prompt_result = prompt_builder.run(
        tasks=cleaned_inputs.get("tasks", []),
        manifest_summary=cleaned_inputs.get("manifest_summary", {}),
        raw_schema_summary=cleaned_inputs.get("raw_schema_summary", {}),
        language=language,
    )
    return {"prompt": clean_up_new_lines(prompt_result.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate(
    prompt: dict,
    generator: Any,
    generator_name: str,
) -> dict:
    logger.info("Semantic Dictionary batch using model: %s", generator_name)
    return await generator(prompt=prompt.get("prompt")), generator_name


def _coerce_items(payload: Any) -> list[dict]:
    if isinstance(payload, dict):
        if isinstance(payload.get("items"), list):
            return payload["items"]
        if isinstance(payload.get("semanticDictionary"), list):
            return payload["semanticDictionary"]
    if isinstance(payload, list):
        return payload
    return []


def _normalize_aliases(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    aliases = []
    for item in value:
        if isinstance(item, str) and item.strip():
            aliases.append(item.strip())
    return list(dict.fromkeys(aliases))


def _normalize_value_mappings(raw_item: dict) -> list[dict]:
    if isinstance(raw_item.get("valueMappings"), list):
        mappings = []
        for mapping in raw_item["valueMappings"]:
            if not isinstance(mapping, dict):
                continue
            canonical = mapping.get("canonicalValue")
            aliases = _normalize_aliases(mapping.get("aliases"))
            if not isinstance(canonical, str) or not canonical.strip() or not aliases:
                continue
            mappings.append(
                {
                    "canonicalValue": canonical.strip(),
                    "aliases": aliases,
                    "description": mapping.get("description"),
                }
            )
        return mappings

    canonical_value = raw_item.get("canonicalValue")
    aliases = _normalize_aliases(raw_item.get("aliases"))
    if isinstance(canonical_value, str) and canonical_value.strip() and aliases:
        return [
            {
                "canonicalValue": canonical_value.strip(),
                "aliases": aliases,
                "description": raw_item.get("description"),
            }
        ]

    if isinstance(canonical_value, list) and isinstance(raw_item.get("aliases"), list):
        canonicals = [
            item.strip()
            for item in canonical_value
            if isinstance(item, str) and item.strip()
        ]
        aliases_list = [
            item.strip()
            for item in raw_item.get("aliases", [])
            if isinstance(item, str) and item.strip()
        ]
        if canonicals and len(canonicals) == len(aliases_list):
            return [
                {
                    "canonicalValue": canonical,
                    "aliases": [alias],
                    "description": raw_item.get("description"),
                }
                for canonical, alias in zip(canonicals, aliases_list)
            ]

    return []


@observe(capture_input=False)
def normalized(generate: dict) -> dict:
    normalized_result = loads_llm_json(generate.get("replies")[0])
    items = _coerce_items(normalized_result)
    return {"items": items}


@observe(capture_input=False)
def validated(normalized: dict, tasks: list[dict]) -> dict:
    task_map = {
        task["taskId"]: task for task in tasks if isinstance(task, dict) and task.get("taskId")
    }

    validated_items = []
    for item in normalized.get("items", []):
        if not isinstance(item, dict):
            continue

        task_id = item.get("taskId")
        task = task_map.get(task_id)
        if not task:
            model_name = item.get("model")
            column_name = item.get("column")
            rewrite_mode = item.get("rewriteMode")
            task = next(
                (
                    candidate
                    for candidate in task_map.values()
                    if candidate.get("scope", {}).get("model") == model_name
                    and candidate.get("scope", {}).get("column") == column_name
                    and candidate.get("rewriteMode") == rewrite_mode
                ),
                None,
            )
            task_id = task.get("taskId") if task else None

        if not task_id or not task:
            continue

        aliases = _normalize_aliases(item.get("aliases"))
        concept = item.get("concept") if isinstance(item.get("concept"), str) else None
        description = (
            item.get("description") if isinstance(item.get("description"), str) else None
        )
        value_mappings = _normalize_value_mappings(item)

        validated_items.append(
            {
                "taskId": task_id,
                "concept": concept.strip() if concept else None,
                "description": description.strip() if description else None,
                "aliases": aliases,
                "valueMappings": value_mappings,
            }
        )

    logger.info(
        "Semantic Dictionary batch validated: input_tasks=%s output_items=%s",
        len(task_map),
        len(validated_items),
    )
    return {"items": validated_items}


class SemanticDictionary(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **_,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(template=user_prompt_template),
            "generator": llm_provider.get_generator(
                system_prompt=system_prompt,
                generation_kwargs=SEMANTIC_DICTIONARY_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
        }
        self._final = "validated"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Semantic Dictionary Batch Generation")
    async def run(
        self,
        tasks: list[dict],
        manifest_summary: dict,
        raw_schema_summary: dict,
        language: str,
        **kwargs,
    ):
        logger.info(
            "SemanticDictionary pipeline is running... tasks=%s",
            len(tasks or []),
        )

        return await self._pipe.execute(
            ["validated"],
            inputs={
                "tasks": tasks,
                "manifest_summary": manifest_summary,
                "raw_schema_summary": raw_schema_summary,
                "language": language,
                **self._components,
            },
        )
