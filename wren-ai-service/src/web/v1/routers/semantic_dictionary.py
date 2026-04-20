from fastapi import APIRouter, Depends

from src.globals import ServiceContainer, get_service_container
from src.web.v1.services.semantic_dictionary import SemanticDictionaryService

router = APIRouter()


@router.post("/semantic-dictionaries")
async def generate(
    request: SemanticDictionaryService.Request,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SemanticDictionaryService.Response:
    return await service_container.semantic_dictionary_service.generate(request)
