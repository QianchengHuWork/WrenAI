import asyncio
import logging
from typing import Any, Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.config import settings
from src.core.pipeline import BasicPipeline
from src.pipelines.generation.denodo_prompt_context import (
    build_denodo_runtime_instructions,
    prioritize_conversion_core_documents,
)
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent
from src.web.v1.services.denodo_scope_normalization import (
    CandidateModelSummary,
    MatchedRewrite,
    ScopedCanonicalValueDictionary,
    SelectedModels,
    build_candidate_model_summaries,
    filter_dictionary_entries,
    format_candidate_models,
    format_model_names,
    format_rewrite_summaries,
    format_selected_models,
    normalize_semantic_dictionary,
    normalize_log_reason,
    safe_log_value,
    summarize_dictionary_entries,
    validate_query_normalization_result,
    validate_scope_resolution_result,
)

logger = logging.getLogger("wren-ai-service")


def build_runtime_sql_instructions(
    query: str,
    table_names: list[str],
    instructions: list[dict] | None = None,
    semantic_context: str | None = None,
) -> list[dict]:
    return build_denodo_runtime_instructions(
        query,
        table_names,
        semantic_context,
        instructions,
    )


def _selected_model_names(selected_models: SelectedModels | None) -> list[str]:
    if not selected_models:
        return []

    return [
        selected_models.primary_model,
        *[
            model
            for model in selected_models.secondary_models
            if model != selected_models.primary_model
        ],
    ]


def _filter_documents_by_models(
    documents: list[dict],
    selected_models: SelectedModels | None,
) -> list[dict]:
    model_names = set(_selected_model_names(selected_models))
    if not model_names:
        return documents

    filtered_documents = [
        document for document in documents if document.get("table_name") in model_names
    ]
    return filtered_documents or documents


def _should_log_denodo(
    semantic_dictionary: ScopedCanonicalValueDictionary | None,
    semantic_context: str | None,
) -> bool:
    return bool(semantic_dictionary or semantic_context)


def _resolve_denodo_normalization_reason(
    documents: list[dict],
    raw_semantic_dictionary: ScopedCanonicalValueDictionary | None,
    candidate_models: list[CandidateModelSummary],
    pipelines: Dict[str, BasicPipeline],
) -> str:
    if not settings.enable_denodo_scope_normalization:
        return "feature_disabled"
    if not raw_semantic_dictionary:
        return "no_dictionary"
    if not documents:
        return "no_documents"
    if not candidate_models:
        return "no_candidate_models"
    if "scope_resolution" not in pipelines:
        return "scope_resolution_pipeline_missing"
    if "query_normalization" not in pipelines:
        return "query_normalization_pipeline_missing"
    return "ready"


def _log_denodo_event(
    level: Literal["info", "warning", "error"],
    event: str,
    query_id: str,
    trace_id: str | None,
    project_id: str | None,
    **fields: Any,
):
    message_parts = [
        event,
        f"query_id={safe_log_value(query_id, limit=80)}",
        f"trace_id={safe_log_value(trace_id, limit=80)}",
        f"project_id={safe_log_value(project_id, limit=80)}",
    ]
    for key, value in fields.items():
        message_parts.append(f"{key}={safe_log_value(value)}")

    getattr(logger, level)(" ".join(message_parts))


class AskHistory(BaseModel):
    sql: str
    question: str


# POST /v1/asks
class AskRequest(BaseRequest):
    query: str
    # don't recommend to use id as a field name, but it's used in the older version of API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: Optional[str] = Field(validation_alias=AliasChoices("mdl_hash", "id"))
    histories: Optional[list[AskHistory]] = Field(default_factory=list)
    ignore_sql_generation_reasoning: bool = False
    enable_column_pruning: bool = False
    use_dry_plan: bool = False
    allow_dry_plan_fallback: bool = True
    custom_instruction: Optional[str] = None
    semantic_context: Optional[str] = None
    semantic_dictionary: Optional[ScopedCanonicalValueDictionary] = Field(
        default=None,
        validation_alias=AliasChoices("semantic_dictionary", "semanticDictionary"),
    )


class AskResponse(BaseModel):
    query_id: str


# PATCH /v1/asks/{query_id}
class StopAskRequest(BaseRequest):
    status: Literal["stopped"]


class StopAskResponse(BaseModel):
    query_id: str


# GET /v1/asks/{query_id}/result
class AskResult(BaseModel):
    sql: str
    type: Literal["llm", "view"] = "llm"
    viewId: Optional[str] = None


class AskError(BaseModel):
    code: Literal["NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"]
    message: str


class AskResultRequest(BaseModel):
    query_id: str


class _AskResultResponse(BaseModel):
    status: Literal[
        "understanding",
        "searching",
        "planning",
        "generating",
        "correcting",
        "finished",
        "failed",
        "stopped",
    ]
    rephrased_question: Optional[str] = None
    intent_reasoning: Optional[str] = None
    sql_generation_reasoning: Optional[str] = None
    type: Optional[Literal["GENERAL", "TEXT_TO_SQL"]] = None
    retrieved_tables: Optional[List[str]] = None
    candidate_models: Optional[List[CandidateModelSummary]] = None
    selected_models: Optional[SelectedModels] = None
    normalized_query: Optional[str] = None
    matched_rewrites: Optional[List[MatchedRewrite]] = None
    response: Optional[List[AskResult]] = None
    invalid_sql: Optional[str] = None
    error: Optional[AskError] = None
    trace_id: Optional[str] = None
    is_followup: bool = False
    general_type: Optional[
        Literal["MISLEADING_QUERY", "DATA_ASSISTANCE", "USER_GUIDE"]
    ] = None


class AskResultResponse(_AskResultResponse):
    is_followup: Optional[bool] = Field(False, exclude=True)
    general_type: Optional[
        Literal["MISLEADING_QUERY", "DATA_ASSISTANCE", "USER_GUIDE"]
    ] = Field(None, exclude=True)


class AskService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = True,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
        max_histories: int = 5,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_results: Dict[str, AskResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_diagnosis = allow_sql_diagnosis
        self._allow_sql_knowledge_retrieval = allow_sql_knowledge_retrieval
        self._enable_column_pruning = enable_column_pruning
        self._max_histories = max_histories
        self._max_sql_correction_retries = max_sql_correction_retries

    def _is_stopped(self, query_id: str, container: dict):
        if (
            result := container.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    @observe(name="Ask Question")
    @trace_metadata
    async def ask(
        self,
        ask_request: AskRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "ask_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
                "request_from": ask_request.request_from,
            },
        }

        query_id = ask_request.query_id
        histories = ask_request.histories[: self._max_histories][
            ::-1
        ]  # reverse the order of histories
        rephrased_question = None
        intent_reasoning = None
        sql_generation_reasoning = None
        sql_samples = []
        instructions = []
        api_results = []
        table_names = []
        error_message = None
        invalid_sql = None
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )
        allow_sql_functions_retrieval = self._allow_sql_functions_retrieval
        allow_sql_diagnosis = self._allow_sql_diagnosis
        allow_sql_knowledge_retrieval = self._allow_sql_knowledge_retrieval
        max_sql_correction_retries = self._max_sql_correction_retries
        current_sql_correction_retries = 0
        use_dry_plan = ask_request.use_dry_plan
        allow_dry_plan_fallback = ask_request.allow_dry_plan_fallback
        sql_knowledge = None
        semantic_context = ask_request.semantic_context
        raw_semantic_dictionary = normalize_semantic_dictionary(
            ask_request.semantic_dictionary
        )
        semantic_dictionary = (
            raw_semantic_dictionary
            if settings.enable_denodo_scope_normalization
            else None
        )
        denodo_logging_enabled = _should_log_denodo(
            raw_semantic_dictionary,
            semantic_context,
        )
        candidate_models: list[CandidateModelSummary] = []
        selected_models: SelectedModels | None = None
        normalized_query: str | None = None
        matched_rewrites: list[MatchedRewrite] = []
        scoped_semantic_context = semantic_context

        try:
            user_query = ask_request.query

            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            if not self._is_stopped(query_id, self._ask_results):
                self._ask_results[query_id] = AskResultResponse(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                historical_question = await self._pipelines["historical_question"].run(
                    query=user_query,
                    project_id=ask_request.project_id,
                )

                # we only return top 1 result
                historical_question_result = historical_question.get(
                    "formatted_output", {}
                ).get("documents", [])[:1]

                if historical_question_result:
                    api_results = [
                        AskResult(
                            **{
                                "sql": result.get("statement"),
                                "type": "view" if result.get("viewId") else "llm",
                                "viewId": result.get("viewId"),
                            }
                        )
                        for result in historical_question_result
                    ]
                    sql_generation_reasoning = ""
                else:
                    # Run both pipeline operations concurrently
                    sql_samples_task, instructions_task = await asyncio.gather(
                        self._pipelines["sql_pairs_retrieval"].run(
                            query=user_query,
                            project_id=ask_request.project_id,
                        ),
                        self._pipelines["instructions_retrieval"].run(
                            query=user_query,
                            project_id=ask_request.project_id,
                            scope="sql",
                        ),
                    )

                    # Extract results from completed tasks
                    sql_samples = sql_samples_task["formatted_output"].get(
                        "documents", []
                    )
                    instructions = instructions_task["formatted_output"].get(
                        "documents", []
                    )

                    if self._allow_intent_classification:
                        intent_classification_result = (
                            await self._pipelines["intent_classification"].run(
                                query=user_query,
                                histories=histories,
                                sql_samples=sql_samples,
                                instructions=instructions,
                                project_id=ask_request.project_id,
                                configuration=ask_request.configurations,
                            )
                        ).get("post_process", {})
                        intent = intent_classification_result.get("intent")
                        rephrased_question = intent_classification_result.get(
                            "rephrased_question"
                        )
                        intent_reasoning = intent_classification_result.get("reasoning")

                        if rephrased_question:
                            user_query = rephrased_question

                        if intent == "MISLEADING_QUERY":
                            asyncio.create_task(
                                self._pipelines["misleading_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="MISLEADING_QUERY",
                            )
                            results["metadata"]["type"] = "MISLEADING_QUERY"
                            return results
                        elif intent == "GENERAL":
                            asyncio.create_task(
                                self._pipelines["data_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="DATA_ASSISTANCE",
                            )
                            results["metadata"]["type"] = "GENERAL"
                            return results
                        elif intent == "USER_GUIDE":
                            asyncio.create_task(
                                self._pipelines["user_guide_assistance"].run(
                                    query=user_query,
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="USER_GUIDE",
                            )
                            results["metadata"]["type"] = "GENERAL"
                            return results
                        else:
                            self._ask_results[query_id] = AskResultResponse(
                                status="understanding",
                                type="TEXT_TO_SQL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                            )
            if not self._is_stopped(query_id, self._ask_results) and not api_results:
                self._ask_results[query_id] = AskResultResponse(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                retrieval_result = await self._pipelines["db_schema_retrieval"].run(
                    query=user_query,
                    histories=histories,
                    project_id=ask_request.project_id,
                    enable_column_pruning=enable_column_pruning,
                )
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents = prioritize_conversion_core_documents(
                    user_query,
                    _retrieval_result.get("retrieval_results", []),
                )
                table_names = [document.get("table_name") for document in documents]
                table_ddls = [document.get("table_ddl") for document in documents]
                candidate_models = (
                    build_candidate_model_summaries(
                        _retrieval_result.get("db_schemas", []),
                        raw_semantic_dictionary,
                    )
                    if _retrieval_result.get("db_schemas")
                    else []
                )
                instructions = build_runtime_sql_instructions(
                    user_query,
                    table_names,
                    instructions,
                    scoped_semantic_context,
                )
                if denodo_logging_enabled:
                    _log_denodo_event(
                        "info",
                        "denodo_ask.retrieval_summary",
                        query_id,
                        trace_id,
                        ask_request.project_id,
                        candidate_model_count=len(candidate_models),
                        candidate_models=format_candidate_models(candidate_models, limit=8),
                        retrieved_table_count=len(table_names),
                        retrieved_tables=format_model_names(table_names, limit=8),
                        dictionary_entry_count=(
                            len(raw_semantic_dictionary.entries)
                            if raw_semantic_dictionary
                            else 0
                        ),
                    )

                normalization_reason = _resolve_denodo_normalization_reason(
                    documents=documents,
                    raw_semantic_dictionary=raw_semantic_dictionary,
                    candidate_models=candidate_models,
                    pipelines=self._pipelines,
                )
                if denodo_logging_enabled:
                    _log_denodo_event(
                        "info",
                        "denodo_ask.normalization_path",
                        query_id,
                        trace_id,
                        ask_request.project_id,
                        enabled=normalization_reason == "ready",
                        reason=normalization_reason,
                    )

                if normalization_reason == "ready" and semantic_dictionary:
                    try:
                        scope_resolution_result = await self._pipelines[
                            "scope_resolution"
                        ].run(
                            query=user_query,
                            candidate_models=candidate_models,
                            configuration=ask_request.configurations,
                        )
                        scope_resolution_payload = scope_resolution_result.get(
                            "post_process", {}
                        )
                        selected_models = validate_scope_resolution_result(
                            scope_resolution_payload,
                            candidate_models,
                        )

                        if selected_models:
                            if denodo_logging_enabled:
                                _log_denodo_event(
                                    "info",
                                    "denodo_ask.scope_resolution_result",
                                    query_id,
                                    trace_id,
                                    ask_request.project_id,
                                    candidate_model_count=len(candidate_models),
                                    selected_models=format_selected_models(
                                        selected_models
                                    ),
                                    primary_model=selected_models.primary_model,
                                    secondary_models=format_model_names(
                                        selected_models.secondary_models,
                                        limit=4,
                                    ),
                                    needs_join=selected_models.needs_join,
                                )
                            selected_candidate_models = [
                                candidate
                                for candidate in candidate_models
                                if candidate.model in _selected_model_names(selected_models)
                            ]
                            selected_dictionary_entries = filter_dictionary_entries(
                                semantic_dictionary,
                                _selected_model_names(selected_models),
                            )
                            scoped_semantic_context = (
                                summarize_dictionary_entries(selected_dictionary_entries)
                                or semantic_context
                            )
                            normalization_result = await self._pipelines[
                                "query_normalization"
                            ].run(
                                query=user_query,
                                selected_models=selected_models,
                                selected_candidate_models=selected_candidate_models,
                                dictionary_entries=selected_dictionary_entries,
                                configuration=ask_request.configurations,
                            )
                            normalization_payload = normalization_result.get(
                                "post_process", {}
                            )
                            (
                                normalized_query,
                                matched_rewrites,
                            ) = validate_query_normalization_result(
                                normalization_payload,
                                user_query,
                                selected_dictionary_entries,
                            )
                            raw_rewrite_count = 0
                            if isinstance(normalization_payload, dict) and isinstance(
                                normalization_payload.get("matched_rewrites"), list
                            ):
                                raw_rewrite_count = len(
                                    normalization_payload.get("matched_rewrites", [])
                                )
                            if denodo_logging_enabled:
                                _log_denodo_event(
                                    "info",
                                    "denodo_ask.query_normalization_result",
                                    query_id,
                                    trace_id,
                                    ask_request.project_id,
                                    rewritten=normalized_query != user_query,
                                    normalized_query=normalized_query,
                                    rewrite_count=len(matched_rewrites),
                                    raw_rewrite_count=raw_rewrite_count,
                                    rewrites=format_rewrite_summaries(
                                        matched_rewrites,
                                        limit=6,
                                    ),
                                )
                                if (
                                    raw_rewrite_count
                                    and not matched_rewrites
                                    and isinstance(normalization_payload, dict)
                                ):
                                    _log_denodo_event(
                                        "warning",
                                        "denodo_ask.fallback",
                                        query_id,
                                        trace_id,
                                        ask_request.project_id,
                                        reason="invalid_query_normalization_output",
                                        detail="all_llm_rewrites_filtered_out",
                                    )
                            table_names_before_narrowing = [
                                document.get("table_name") for document in documents
                            ]
                            documents = _filter_documents_by_models(
                                documents,
                                selected_models,
                            )
                            table_names_after_narrowing = [
                                document.get("table_name") for document in documents
                            ]
                            table_ddls = [
                                document.get("table_ddl") for document in documents
                            ]
                            if denodo_logging_enabled:
                                _log_denodo_event(
                                    "info",
                                    "denodo_ask.schema_narrowing_result",
                                    query_id,
                                    trace_id,
                                    ask_request.project_id,
                                    narrowed=(
                                        table_names_before_narrowing
                                        != table_names_after_narrowing
                                    ),
                                    before_document_count=len(
                                        table_names_before_narrowing
                                    ),
                                    after_document_count=len(table_names_after_narrowing),
                                    before_tables=format_model_names(
                                        table_names_before_narrowing,
                                        limit=8,
                                    ),
                                    after_tables=format_model_names(
                                        table_names_after_narrowing,
                                        limit=8,
                                    ),
                                )
                        else:
                            scoped_semantic_context = semantic_context
                            if denodo_logging_enabled:
                                _log_denodo_event(
                                    "warning",
                                    "denodo_ask.fallback",
                                    query_id,
                                    trace_id,
                                    ask_request.project_id,
                                    reason="invalid_scope_resolution_output",
                                    detail=scope_resolution_payload,
                                )
                    except Exception as error:
                        if denodo_logging_enabled:
                            _log_denodo_event(
                                "warning",
                                "denodo_ask.fallback",
                                query_id,
                                trace_id,
                                ask_request.project_id,
                                reason=normalize_log_reason(
                                    "scope_normalization_exception"
                                ),
                                detail=str(error),
                            )
                        logger.warning(
                            "Scope resolution / query normalization fallback to legacy flow: %s",
                            error,
                        )
                        selected_models = None
                        normalized_query = None
                        matched_rewrites = []
                        scoped_semantic_context = semantic_context

                if not documents:
                    if denodo_logging_enabled:
                        _log_denodo_event(
                            "error",
                            "denodo_ask.final_result",
                            query_id,
                            trace_id,
                            ask_request.project_id,
                            status="failed",
                            error_type="NO_RELEVANT_DATA",
                        )
                    logger.exception(f"ask pipeline - NO_RELEVANT_DATA: {user_query}")
                    if not self._is_stopped(query_id, self._ask_results):
                        self._ask_results[query_id] = AskResultResponse(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=AskError(
                                code="NO_RELEVANT_DATA",
                                message="No relevant data",
                            ),
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            candidate_models=candidate_models or None,
                            selected_models=selected_models,
                            normalized_query=normalized_query,
                            matched_rewrites=matched_rewrites,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

            if (
                not self._is_stopped(query_id, self._ask_results)
                and not api_results
                and allow_sql_generation_reasoning
            ):
                query_for_generation = normalized_query or user_query
                if denodo_logging_enabled:
                    _log_denodo_event(
                        "info",
                        "denodo_ask.downstream_context",
                        query_id,
                        trace_id,
                        ask_request.project_id,
                        stage="planning",
                        using_normalized_query=(
                            normalized_query != user_query if normalized_query else False
                        ),
                        query_for_generation=query_for_generation,
                        selected_models=format_selected_models(selected_models),
                        rewrite_count=len(matched_rewrites),
                        rewrites=format_rewrite_summaries(
                            matched_rewrites,
                            limit=6,
                        ),
                    )
                self._ask_results[query_id] = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    candidate_models=candidate_models or None,
                    selected_models=selected_models,
                    normalized_query=normalized_query,
                    matched_rewrites=matched_rewrites,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if histories:
                    sql_generation_reasoning = (
                        await self._pipelines["followup_sql_generation_reasoning"].run(
                            query=query_for_generation,
                            contexts=table_ddls,
                            histories=histories,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            semantic_context=scoped_semantic_context,
                            configuration=ask_request.configurations,
                            query_id=query_id,
                            original_query=user_query,
                            normalized_query=normalized_query,
                            matched_rewrites=[
                                rewrite.model_dump() for rewrite in matched_rewrites
                            ],
                            selected_models=(
                                selected_models.model_dump()
                                if selected_models
                                else None
                            ),
                        )
                    ).get("post_process", {})
                else:
                    sql_generation_reasoning = (
                        await self._pipelines["sql_generation_reasoning"].run(
                            query=query_for_generation,
                            contexts=table_ddls,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            semantic_context=scoped_semantic_context,
                            configuration=ask_request.configurations,
                            query_id=query_id,
                            original_query=user_query,
                            normalized_query=normalized_query,
                            matched_rewrites=[
                                rewrite.model_dump() for rewrite in matched_rewrites
                            ],
                            selected_models=(
                                selected_models.model_dump()
                                if selected_models
                                else None
                            ),
                        )
                    ).get("post_process", {})

                self._ask_results[query_id] = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    candidate_models=candidate_models or None,
                    selected_models=selected_models,
                    normalized_query=normalized_query,
                    matched_rewrites=matched_rewrites,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

            if not self._is_stopped(query_id, self._ask_results) and not api_results:
                query_for_generation = normalized_query or user_query
                if denodo_logging_enabled:
                    _log_denodo_event(
                        "info",
                        "denodo_ask.downstream_context",
                        query_id,
                        trace_id,
                        ask_request.project_id,
                        stage="generation",
                        using_normalized_query=(
                            normalized_query != user_query if normalized_query else False
                        ),
                        query_for_generation=query_for_generation,
                        selected_models=format_selected_models(selected_models),
                        rewrite_count=len(matched_rewrites),
                        rewrites=format_rewrite_summaries(
                            matched_rewrites,
                            limit=6,
                        ),
                    )
                self._ask_results[query_id] = AskResultResponse(
                    status="generating",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    candidate_models=candidate_models or None,
                    selected_models=selected_models,
                    normalized_query=normalized_query,
                    matched_rewrites=matched_rewrites,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if allow_sql_functions_retrieval:
                    sql_functions = await self._pipelines[
                        "sql_functions_retrieval"
                    ].run(
                        project_id=ask_request.project_id,
                    )
                else:
                    sql_functions = []

                if allow_sql_knowledge_retrieval:
                    sql_knowledge = await self._pipelines[
                        "sql_knowledge_retrieval"
                    ].run(
                        project_id=ask_request.project_id,
                    )

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)

                if histories:
                    text_to_sql_generation_results = await self._pipelines[
                        "followup_sql_generation"
                    ].run(
                        query=query_for_generation,
                        contexts=table_ddls,
                        sql_generation_reasoning=sql_generation_reasoning,
                        histories=histories,
                        project_id=ask_request.project_id,
                        sql_samples=sql_samples,
                        instructions=instructions,
                        semantic_context=scoped_semantic_context,
                        has_calculated_field=has_calculated_field,
                        has_metric=has_metric,
                        has_json_field=has_json_field,
                        sql_functions=sql_functions,
                        use_dry_plan=use_dry_plan,
                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                        sql_knowledge=sql_knowledge,
                        original_query=user_query,
                        normalized_query=normalized_query,
                        matched_rewrites=[
                            rewrite.model_dump() for rewrite in matched_rewrites
                        ],
                        selected_models=(
                            selected_models.model_dump() if selected_models else None
                        ),
                    )
                else:
                    text_to_sql_generation_results = await self._pipelines[
                        "sql_generation"
                    ].run(
                        query=query_for_generation,
                        contexts=table_ddls,
                        sql_generation_reasoning=sql_generation_reasoning,
                        project_id=ask_request.project_id,
                        sql_samples=sql_samples,
                        instructions=instructions,
                        semantic_context=scoped_semantic_context,
                        has_calculated_field=has_calculated_field,
                        has_metric=has_metric,
                        has_json_field=has_json_field,
                        sql_functions=sql_functions,
                        use_dry_plan=use_dry_plan,
                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                        sql_knowledge=sql_knowledge,
                        original_query=user_query,
                        normalized_query=normalized_query,
                        matched_rewrites=[
                            rewrite.model_dump() for rewrite in matched_rewrites
                        ],
                        selected_models=(
                            selected_models.model_dump() if selected_models else None
                        ),
                    )

                if sql_valid_result := text_to_sql_generation_results["post_process"][
                    "valid_generation_result"
                ]:
                    api_results = [
                        AskResult(
                            **{
                                "sql": sql_valid_result.get("sql"),
                                "type": "llm",
                            }
                        )
                    ]
                    if denodo_logging_enabled:
                        _log_denodo_event(
                            "info",
                            "denodo_ask.generation_result",
                            query_id,
                            trace_id,
                            ask_request.project_id,
                            status="valid",
                            correction_attempts=current_sql_correction_retries,
                        )
                elif failed_dry_run_result := text_to_sql_generation_results[
                    "post_process"
                ]["invalid_generation_result"]:
                    if denodo_logging_enabled:
                        _log_denodo_event(
                            "warning",
                            "denodo_ask.generation_result",
                            query_id,
                            trace_id,
                            ask_request.project_id,
                            status="invalid",
                            error=failed_dry_run_result.get("error"),
                            correction_planned=True,
                        )
                    while current_sql_correction_retries < max_sql_correction_retries:
                        if failed_dry_run_result["type"] == "TIME_OUT":
                            if denodo_logging_enabled:
                                _log_denodo_event(
                                    "warning",
                                    "denodo_ask.sql_correction_result",
                                    query_id,
                                    trace_id,
                                    ask_request.project_id,
                                    status="timeout",
                                    attempt=current_sql_correction_retries + 1,
                                )
                            break

                        original_sql = failed_dry_run_result["original_sql"]
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]
                        current_sql_correction_retries += 1
                        if denodo_logging_enabled:
                            _log_denodo_event(
                                "info",
                                "denodo_ask.sql_correction_attempt",
                                query_id,
                                trace_id,
                                ask_request.project_id,
                                attempt=current_sql_correction_retries,
                                error=error_message,
                                rewrite_count=len(matched_rewrites),
                            )

                        self._ask_results[query_id] = AskResultResponse(
                            status="correcting",
                            type="TEXT_TO_SQL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            sql_generation_reasoning=sql_generation_reasoning,
                            candidate_models=candidate_models or None,
                            selected_models=selected_models,
                            normalized_query=normalized_query,
                            matched_rewrites=matched_rewrites,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )

                        if allow_sql_diagnosis:
                            sql_diagnosis_results = await self._pipelines[
                                "sql_diagnosis"
                            ].run(
                                contexts=table_ddls,
                                original_sql=original_sql,
                                invalid_sql=invalid_sql,
                                error_message=error_message,
                                language=ask_request.configurations.language,
                            )
                            sql_diagnosis_reasoning = sql_diagnosis_results[
                                "post_process"
                            ].get("reasoning")

                        sql_correction_results = await self._pipelines[
                            "sql_correction"
                        ].run(
                            contexts=table_ddls,
                            instructions=instructions,
                            invalid_generation_result={
                                "sql": original_sql,
                                "error": sql_diagnosis_reasoning
                                if allow_sql_diagnosis
                                else error_message,
                            },
                            project_id=ask_request.project_id,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_functions=sql_functions,
                            sql_knowledge=sql_knowledge,
                            semantic_context=scoped_semantic_context,
                            original_query=user_query,
                            normalized_query=normalized_query,
                            matched_rewrites=[
                                rewrite.model_dump() for rewrite in matched_rewrites
                            ],
                            selected_models=(
                                selected_models.model_dump()
                                if selected_models
                                else None
                            ),
                        )

                        if valid_generation_result := sql_correction_results[
                            "post_process"
                        ]["valid_generation_result"]:
                            api_results = [
                                AskResult(
                                    **{
                                        "sql": valid_generation_result.get("sql"),
                                        "type": "llm",
                                    }
                                )
                            ]
                            if denodo_logging_enabled:
                                _log_denodo_event(
                                    "info",
                                    "denodo_ask.sql_correction_result",
                                    query_id,
                                    trace_id,
                                    ask_request.project_id,
                                    status="corrected",
                                    attempt=current_sql_correction_retries,
                                )
                            break

                        failed_dry_run_result = sql_correction_results["post_process"][
                            "invalid_generation_result"
                        ]
                        if denodo_logging_enabled:
                            _log_denodo_event(
                                "warning",
                                "denodo_ask.sql_correction_result",
                                query_id,
                                trace_id,
                                ask_request.project_id,
                                status="retry_failed",
                                attempt=current_sql_correction_retries,
                                error=failed_dry_run_result.get("error"),
                            )

            if api_results:
                if denodo_logging_enabled:
                    _log_denodo_event(
                        "info",
                        "denodo_ask.final_result",
                        query_id,
                        trace_id,
                        ask_request.project_id,
                        status="finished",
                        result_count=len(api_results),
                    )
                if not self._is_stopped(query_id, self._ask_results):
                    self._ask_results[query_id] = AskResultResponse(
                        status="finished",
                        type="TEXT_TO_SQL",
                        response=api_results,
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        candidate_models=candidate_models or None,
                        selected_models=selected_models,
                        normalized_query=normalized_query,
                        matched_rewrites=matched_rewrites,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                results["ask_result"] = api_results
                results["metadata"]["type"] = "TEXT_TO_SQL"
            else:
                if denodo_logging_enabled:
                    _log_denodo_event(
                        "error",
                        "denodo_ask.final_result",
                        query_id,
                        trace_id,
                        ask_request.project_id,
                        status="failed",
                        error_type="NO_RELEVANT_SQL",
                        error=error_message or "No relevant SQL",
                    )
                logger.exception(f"ask pipeline - NO_RELEVANT_SQL: {user_query}")
                if not self._is_stopped(query_id, self._ask_results):
                    self._ask_results[query_id] = AskResultResponse(
                        status="failed",
                        type="TEXT_TO_SQL",
                        error=AskError(
                            code="NO_RELEVANT_SQL",
                            message=error_message or "No relevant SQL",
                        ),
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        invalid_sql=invalid_sql,
                        candidate_models=candidate_models or None,
                        selected_models=selected_models,
                        normalized_query=normalized_query,
                        matched_rewrites=matched_rewrites,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                results["metadata"]["error_message"] = error_message
                results["metadata"]["type"] = "TEXT_TO_SQL"

            return results
        except Exception as e:
            if denodo_logging_enabled:
                _log_denodo_event(
                    "error",
                    "denodo_ask.final_result",
                    query_id,
                    trace_id,
                    ask_request.project_id,
                    status="failed",
                    error_type="OTHERS",
                    error=str(e),
                )
            logger.exception(f"ask pipeline - OTHERS: {e}")

            self._ask_results[query_id] = AskResultResponse(
                status="failed",
                type="TEXT_TO_SQL",
                error=AskError(
                    code="OTHERS",
                    message=str(e),
                ),
                candidate_models=candidate_models or None,
                selected_models=selected_models,
                normalized_query=normalized_query,
                matched_rewrites=matched_rewrites,
                trace_id=trace_id,
                is_followup=True if histories else False,
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            results["metadata"]["type"] = "TEXT_TO_SQL"
            return results

    def stop_ask(
        self,
        stop_ask_request: StopAskRequest,
    ):
        self._ask_results[stop_ask_request.query_id] = AskResultResponse(
            status="stopped",
        )

    def get_ask_result(
        self,
        ask_result_request: AskResultRequest,
    ) -> AskResultResponse:
        if (result := self._ask_results.get(ask_result_request.query_id)) is None:
            logger.exception(
                f"ask pipeline - OTHERS: {ask_result_request.query_id} is not found"
            )
            return AskResultResponse(
                status="failed",
                type="TEXT_TO_SQL",
                error=AskError(
                    code="OTHERS",
                    message=f"{ask_result_request.query_id} is not found",
                ),
            )

        return result

    async def get_ask_streaming_result(
        self,
        query_id: str,
    ):
        if self._ask_results.get(query_id):
            _pipeline_name = ""
            if self._ask_results.get(query_id).type == "GENERAL":
                if self._ask_results.get(query_id).general_type == "USER_GUIDE":
                    _pipeline_name = "user_guide_assistance"
                elif self._ask_results.get(query_id).general_type == "DATA_ASSISTANCE":
                    _pipeline_name = "data_assistance"
                elif self._ask_results.get(query_id).general_type == "MISLEADING_QUERY":
                    _pipeline_name = "misleading_assistance"
            elif self._ask_results.get(query_id).status == "planning":
                if self._ask_results.get(query_id).is_followup:
                    _pipeline_name = "followup_sql_generation_reasoning"
                else:
                    _pipeline_name = "sql_generation_reasoning"

            if _pipeline_name:
                async for chunk in self._pipelines[
                    _pipeline_name
                ].get_streaming_results(query_id):
                    event = SSEEvent(
                        data=SSEEvent.SSEEventMessage(message=chunk),
                    )
                    yield event.serialize()
