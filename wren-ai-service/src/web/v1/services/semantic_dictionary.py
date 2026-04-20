import logging
from uuid import uuid4
from typing import Dict

from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest

logger = logging.getLogger("wren-ai-service")


class SemanticDictionaryService:
    class Request(BaseRequest):
        tasks: list[dict]
        manifest_summary: dict
        raw_schema_summary: dict

    class Response(BaseModel):
        items: list[dict]

    def __init__(self, pipelines: Dict[str, BasicPipeline]):
        self._pipelines = pipelines

    @observe(name="Generate Semantic Dictionary")
    @trace_metadata
    async def generate(self, request: Request, **_kwargs) -> Response:
        logger.info("Generate Semantic Dictionary service is running...")
        query_id = f"semantic-dictionary-{uuid4()}"
        logger.info("Semantic Dictionary request id: %s", query_id)

        result = await self._pipelines["semantic_dictionary"].run(
            tasks=request.tasks,
            manifest_summary=request.manifest_summary,
            raw_schema_summary=request.raw_schema_summary,
            language=request.configurations.language,
        )

        logger.info(
            "Semantic Dictionary batch finished. query_id=%s tasks=%s items=%s",
            query_id,
            len(request.tasks or []),
            len(result.get("items", [])),
        )
        return self.Response(items=result.get("items", []))
