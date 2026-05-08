from src.pipelines.generation.denodo_prompt_context import (
    DENODO_CONTEXT_MARKER,
    build_denodo_runtime_instructions,
    get_denodo_technical_rules,
)


def test_denodo_technical_rules_are_not_business_formulas():
    rules = get_denodo_technical_rules()

    assert "FLOAT" in rules
    assert "NULLIF" in rules
    assert "LIMIT, FETCH, TOP" in rules
    assert "NULLS FIRST/LAST" in rules
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
