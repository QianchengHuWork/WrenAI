from src.pipelines.generation.denodo_prompt_context import (
    DENODO_BUSINESS_FORMULA_INSTRUCTION_ID,
    DENODO_CONTEXT_MARKER,
    DENODO_TECHNICAL_RULES_INSTRUCTION_ID,
    build_denodo_runtime_instructions,
    is_conversion_rate_query,
    prioritize_conversion_core_documents,
)


def test_detect_conversion_rate_query():
    assert is_conversion_rate_query(
        "算一下最近三个月，每个月的订单转化率是环比增长了还是下降了？"
    )
    assert is_conversion_rate_query(
        "Show month-over-month conversion trend for the last quarter"
    )
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


def test_build_runtime_sql_instructions_for_denodo_context():
    instructions = build_denodo_runtime_instructions(
        "最近三个月转化率环比趋势",
        ["dv_ord_core", "dv_clew_ord_conversion_core", "dv_clew_total_core"],
        DENODO_CONTEXT_MARKER,
        [{"instruction": "existing"}],
    )

    assert instructions[0]["instruction"] == "existing"
    assert instructions[1]["instruction_id"] == DENODO_TECHNICAL_RULES_INSTRUCTION_ID
    assert "FLOAT" in instructions[1]["instruction"]
    assert "NULLIF" in instructions[1]["instruction"]
    assert "converted_order_count" not in instructions[1]["instruction"]
    assert "assigned_clew_count" not in instructions[1]["instruction"]
    assert instructions[2]["instruction_id"] == DENODO_BUSINESS_FORMULA_INSTRUCTION_ID
    assert "converted_order_count / total_clew_count" in instructions[2]["instruction"]


def test_skip_runtime_instruction_without_denodo_context():
    instructions = build_denodo_runtime_instructions(
        "最近三个月转化率环比趋势",
        ["dv_ord_core", "dv_clew_ord_conversion_core"],
        None,
        [],
    )

    assert instructions == []
