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
    canonicalValue: str
    columnType: str | None = None
    description: str | None = None
    modelDescription: str | None = None


class SemanticDictionaryBatchItem(BaseModel):
    taskId: str
    description: str | None = None
    aliases: list[str] = Field(default_factory=list)


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
You fill scoped canonical value dictionary tasks for a BI semantic layer.

Return JSON only. Do not return prose.

Rules:
1. Only fill tasks listed in the input.
2. Every output item must include taskId from the input.
3. The input canonicalValue is already decided by the system. Do not change it.
4. Only provide user-facing aliases or synonyms for that canonicalValue within the given scope.
5. Do not invent joins, metrics, fields, or values that are not grounded in the input.
6. If uncertain, omit the item instead of guessing.
"""

user_prompt_template = """
Language: {{ language }}

### TASKS TO FILL ###
{% for task in tasks %}
- taskId: {{ task.taskId }}
  scope: {{ task.scope.model }}.{{ task.scope.column }}
  canonicalValue: {{ task.canonicalValue }}
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
      "description": "optional short explanation",
      "aliases": ["alias 1", "alias 2"]
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


def _normalize_aliases(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    aliases = []
    seen = set()
    for item in value:
        if not isinstance(item, str):
            continue
        cleaned = item.strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        aliases.append(cleaned)
    return aliases


@observe(capture_input=False)
def normalized(generate: dict) -> dict:
    normalized_result = loads_llm_json(generate.get("replies")[0])
    items = normalized_result.get("items", []) if isinstance(normalized_result, dict) else []
    return {"items": items}


@observe(capture_input=False)
def validated(normalized: dict, tasks: list[dict]) -> dict:
    task_map = {
        task["taskId"]: task
        for task in tasks
        if isinstance(task, dict) and isinstance(task.get("taskId"), str)
    }

    validated_items = []
    for item in normalized.get("items", []):
        if not isinstance(item, dict):
            continue

        task_id = item.get("taskId")
        task = task_map.get(task_id)
        if not task:
            continue

        aliases = _normalize_aliases(item.get("aliases"))
        description = (
            item.get("description").strip()
            if isinstance(item.get("description"), str) and item.get("description").strip()
            else None
        )

        validated_items.append(
            {
                "taskId": task_id,
                "description": description,
                "aliases": aliases,
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
