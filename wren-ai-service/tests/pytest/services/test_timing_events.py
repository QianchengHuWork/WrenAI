from src.web.v1.services.ask import AskResult, AskResultResponse, TimingEvent
from src.web.v1.services.sql_answer import (
    SqlAnswerResultResponse,
    TimingEvent as SqlAnswerTimingEvent,
)


def test_ask_result_response_serializes_timing_events():
    response = AskResultResponse(
        status="finished",
        type="TEXT_TO_SQL",
        timing_events=[
            TimingEvent(
                name="ai.scope_resolution",
                duration_ms=123,
                metadata={"primaryModel": "dm_ord_day_status"},
            )
        ],
    )

    assert response.model_dump()["timing_events"] == [
        {
            "name": "ai.scope_resolution",
            "duration_ms": 123,
            "metadata": {"primaryModel": "dm_ord_day_status"},
        }
    ]


def test_ask_result_serializes_denodo_sql_dialect():
    response = AskResultResponse(
        status="finished",
        type="TEXT_TO_SQL",
        response=[
            AskResult(
                sql='SELECT "city" FROM "dv_order_base"',
                type="llm",
                sql_dialect="DIALECT",
            )
        ],
    )

    assert response.model_dump()["response"][0]["sql_dialect"] == "DIALECT"


def test_sql_answer_result_response_serializes_timing_events():
    response = SqlAnswerResultResponse(
        status="succeeded",
        timing_events=[
            SqlAnswerTimingEvent(
                name="answer.preprocess_sql_data",
                duration_ms=45,
                metadata={"numRowsUsedInLLM": 1},
            )
        ],
    )

    assert response.model_dump()["timing_events"] == [
        {
            "name": "answer.preprocess_sql_data",
            "duration_ms": 45,
            "metadata": {"numRowsUsedInLLM": 1},
        }
    ]
