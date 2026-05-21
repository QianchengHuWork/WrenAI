from src.pipelines.generation.denodo_prompt_context import (
    CONVERSION_CORE_TABLE,
    DENODO_CONTEXT_MARKER,
    DENODO_TEMPORAL_TOPN_DECLINE_INSTRUCTION_ID,
    ORDER_CITY_TABLE,
    build_denodo_vql_post_process_result,
    build_denodo_runtime_instructions,
    get_denodo_temporal_topn_decline_instructions,
    get_denodo_vql_correction_system_prompt,
    get_denodo_vql_generation_system_prompt,
    get_denodo_technical_rules,
    is_denodo_q20_city_conversion_decline_query,
)


def test_denodo_technical_rules_are_not_business_formulas():
    rules = get_denodo_technical_rules()

    assert "FLOAT" in rules
    assert "NULLIF" in rules
    assert "LIMIT, FETCH, TOP" in rules
    assert "NULLS FIRST/LAST" in rules
    assert "Do not use TO_NUMBER" in rules
    assert "Do not introduce a CTE just to compute a casted field" in rules
    assert "Partition fields are view-specific" in rules
    assert "dm_ord_month_city" in rules
    assert "Do not add or subtract integers directly from YYYYMM" in rules
    assert "MAX(order_year_month)" in rules
    assert "Do not use LAG or LEAD" in rules
    assert "month_index" in rules
    assert "correlated-count" in rules
    assert "selected models" in rules
    assert "converted_order_count" not in rules
    assert "assigned_clew_count" not in rules
    assert "total_clew_count" not in rules


def test_generic_conversion_rate_uses_total_leads_denominator():
    instructions = build_denodo_runtime_instructions(
        "最近三个月订单转化率",
        ["dv_clew_ord_conversion_core", "dv_clew_total_core"],
        DENODO_CONTEXT_MARKER,
        [],
    )

    formula = instructions[-1]["instruction"]
    assert "converted_order_count / total_clew_count" in formula
    assert "converted_order_count / assigned_clew_count" not in formula


def test_smart_assignment_conversion_rate_uses_assigned_leads_denominator():
    instructions = build_denodo_runtime_instructions(
        "最近三个月智能分配订单转化率",
        ["dv_clew_ord_conversion_core"],
        DENODO_CONTEXT_MARKER,
        [],
    )

    assert "converted_order_count / assigned_clew_count" in instructions[-1][
        "instruction"
    ]


def test_no_denodo_marker_keeps_existing_instructions_only():
    instructions = build_denodo_runtime_instructions(
        "最近三个月订单转化率",
        ["dv_clew_ord_conversion_core", "dv_clew_total_core"],
        None,
        [{"instruction": "existing"}],
    )

    assert instructions == [{"instruction": "existing"}]


def test_denodo_vql_system_prompts_are_not_ansi_sql_prompts():
    generation_prompt = get_denodo_vql_generation_system_prompt()
    correction_prompt = get_denodo_vql_correction_system_prompt()

    assert "Denodo VQL expert" in generation_prompt
    assert "Denodo VQL expert" in correction_prompt
    assert "ANSI SQL expert" not in generation_prompt
    assert "ANSI SQL expert" not in correction_prompt
    assert "DENODO_VQL_QUERY_STRING" in generation_prompt
    assert "Function lag is not executable" in correction_prompt


def test_denodo_vql_post_process_extracts_json_sql_without_engine_validation():
    result = build_denodo_vql_post_process_result(
        ['{"sql":"SELECT \\"city\\" FROM \\"dv_order_base\\""}']
    )

    assert result["valid_generation_result"]["sql"] == (
        'SELECT "city" FROM "dv_order_base"'
    )
    assert result["invalid_generation_result"] == {}


def test_denodo_q20_temporal_topn_decline_instruction():
    question = (
        "最近 12 个月，订单金额排名前 5 的城市中，哪些城市出现过订单转化率"
        "连续两个月下降？同时给出对应月份和降幅。"
    )

    assert is_denodo_q20_city_conversion_decline_query(question)

    instruction = get_denodo_temporal_topn_decline_instructions(
        question,
        [CONVERSION_CORE_TABLE, ORDER_CITY_TABLE],
    )

    assert instruction is not None
    assert CONVERSION_CORE_TABLE in instruction
    assert ORDER_CITY_TABLE in instruction
    assert "ORDER BY alone is not valid" in instruction
    assert "do not add `ptstart` or `ptend`" in instruction
    assert "Use concrete YYYYMM bounds" in instruction
    assert "MAX(year_month)" in instruction
    assert "month_index" in instruction
    assert "Do not use LAG" in instruction
    assert "m3.conversion_rate < m2.conversion_rate" in instruction


def test_denodo_q20_runtime_instruction_is_appended_after_formula_rules():
    question = (
        "最近 12 个月，订单金额排名前 5 的城市中，哪些城市出现过订单转化率"
        "连续两个月下降？同时给出对应月份和降幅。"
    )

    instructions = build_denodo_runtime_instructions(
        question,
        [CONVERSION_CORE_TABLE, ORDER_CITY_TABLE, "dv_clew_total_core"],
        DENODO_CONTEXT_MARKER,
        [],
    )

    assert instructions[-1]["instruction_id"] == (
        DENODO_TEMPORAL_TOPN_DECLINE_INSTRUCTION_ID
    )
    assert "three self-joined monthly rows" in instructions[-1]["instruction"]
