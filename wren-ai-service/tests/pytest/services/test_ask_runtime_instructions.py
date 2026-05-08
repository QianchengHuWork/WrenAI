from src.web.v1.services.ask import (
    CONVERSION_RATE_PRIORITY_INSTRUCTION,
    build_runtime_sql_instructions,
    is_conversion_rate_query,
    prioritize_conversion_core_documents,
)


def test_detect_conversion_rate_query():
    assert is_conversion_rate_query("算一下最近三个月，每个月的订单转化率是环比增长了还是下降了？")
    assert is_conversion_rate_query("Show month-over-month conversion trend for the last quarter")
    assert not is_conversion_rate_query("帮我统计最近三个月的订单金额")


def test_prioritize_conversion_core_documents():
    documents = [
        {"table_name": "dv_clew_total_core", "table_ddl": "clew ddl"},
        {"table_name": "dv_ord_core", "table_ddl": "order ddl"},
        {
            "table_name": "dv_clew_ord_conversion_core",
            "table_ddl": "conversion ddl",
        },
    ]

    prioritized = prioritize_conversion_core_documents(
        "最近三个月的转化率趋势", documents
    )

    assert prioritized[0]["table_name"] == "dv_clew_ord_conversion_core"


def test_build_runtime_sql_instructions():
    instructions = build_runtime_sql_instructions(
        "最近三个月转化率环比趋势",
        ["dv_ord_core", "dv_clew_ord_conversion_core"],
        [{"instruction": "existing"}],
    )

    assert instructions[0]["instruction"] == "existing"
    assert instructions[1]["instruction"] == CONVERSION_RATE_PRIORITY_INSTRUCTION
    assert (
        "MUST use `table: dv_clew_ord_conversion_core`"
        not in instructions[1]["instruction"]
    )
    assert "FLOAT" in instructions[1]["instruction"]
    assert "NULLIF" in instructions[1]["instruction"]
    assert "converted_order_count" in instructions[1]["instruction"]
    assert "assigned_clew_count" in instructions[1]["instruction"]


def test_skip_runtime_instruction_when_conversion_core_missing():
    instructions = build_runtime_sql_instructions(
        "最近三个月转化率环比趋势",
        ["dv_ord_core", "dv_clew_total_core"],
        [],
    )

    assert instructions == []
