from src.pipelines.generation.denodo_prompt_context import (
    DENODO_BUSINESS_FORMULA_INSTRUCTION_ID,
    DENODO_CONTEXT_MARKER,
    DENODO_TECHNICAL_RULES_INSTRUCTION_ID,
    CONVERSION_CORE_TABLE,
    ORDER_CITY_TABLE,
    build_denodo_runtime_instructions,
    is_conversion_rate_query,
    prioritize_conversion_core_documents,
)
from src.web.v1.services.ask import (
    _build_scoped_denodo_semantic_context,
    _override_denodo_scope_for_known_patterns,
)
from src.web.v1.services.denodo_scope_normalization import (
    CandidateModelSummary,
    SelectedModels,
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


def test_scoped_denodo_semantic_context_preserves_marker_and_native_context():
    semantic_context = "\n\n".join(
        [
            f"Denodo context marker: {DENODO_CONTEXT_MARKER}",
            "Native Denodo VQL schema mapping.",
            'model all_model -> native view "all_model"; native columns: "old_col"',
            "Semantic dictionary entries:\n- scope: old_model.old_col",
        ]
    )

    scoped = _build_scoped_denodo_semantic_context(
        semantic_context,
        '- scope: dv_package_order_core.package_name | aliases: ["选装包"]',
    )

    assert DENODO_CONTEXT_MARKER in scoped
    assert "Native Denodo VQL schema mapping." in scoped
    assert "old_model.old_col" not in scoped
    assert "dv_package_order_core.package_name" in scoped


def test_q20_scope_override_selects_conversion_core_and_city_order_amount():
    selected = _override_denodo_scope_for_known_patterns(
        (
            "最近 12 个月，订单金额排名前 5 的城市中，哪些城市出现过订单转化率"
            "连续两个月下降？同时给出对应月份和降幅。"
        ),
        SelectedModels(
            primary_model="dm_conversion_month_strategy",
            secondary_models=[ORDER_CITY_TABLE],
            needs_join=True,
            reasoning=["llm selected strategy aggregate"],
        ),
        [
            CandidateModelSummary(model="dm_conversion_month_strategy"),
            CandidateModelSummary(model=ORDER_CITY_TABLE),
            CandidateModelSummary(model=CONVERSION_CORE_TABLE),
        ],
    )

    assert selected is not None
    assert selected.primary_model == CONVERSION_CORE_TABLE
    assert selected.secondary_models == [ORDER_CITY_TABLE]
    assert selected.needs_join is True
    assert "Rule override" in selected.reasoning[0]


def test_q20_scope_override_does_not_force_missing_required_models():
    original = SelectedModels(
        primary_model="dm_conversion_month_strategy",
        secondary_models=[ORDER_CITY_TABLE],
        needs_join=True,
    )

    selected = _override_denodo_scope_for_known_patterns(
        (
            "最近 12 个月，订单金额排名前 5 的城市中，哪些城市出现过订单转化率"
            "连续两个月下降？同时给出对应月份和降幅。"
        ),
        original,
        [
            CandidateModelSummary(model="dm_conversion_month_strategy"),
            CandidateModelSummary(model=ORDER_CITY_TABLE),
        ],
    )

    assert selected == original
