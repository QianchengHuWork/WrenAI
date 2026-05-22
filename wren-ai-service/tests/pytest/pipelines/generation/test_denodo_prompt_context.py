from datetime import datetime

from src.pipelines.generation.denodo_prompt_context import (
    ASSIGN_TOTAL_CONVERSION_TABLE,
    CLEW_CORE_TABLE,
    CONVERSION_CORE_TABLE,
    DENODO_BUSINESS_FORMULA_INSTRUCTION_ID,
    DENODO_CONTEXT_MARKER,
    DENODO_TEMPORAL_TOPN_DECLINE_INSTRUCTION_ID,
    ORDER_CITY_TABLE,
    ORD_CORE_TABLE,
    build_denodo_vql_post_process_result,
    build_denodo_runtime_instructions,
    get_denodo_hidden_sql_exemplar_context,
    get_denodo_temporal_topn_decline_instructions,
    get_denodo_vql_correction_system_prompt,
    get_denodo_vql_generation_system_prompt,
    get_denodo_technical_rules,
    is_denodo_q20_city_conversion_decline_query,
)


def test_denodo_technical_rules_are_not_business_formulas():
    rules = get_denodo_technical_rules()

    assert "FLOAT" in rules
    assert "DECIMAL(18, 6)" in rules
    assert "round(double precision, integer)" in rules
    assert "NULLIF" in rules
    assert "LIMIT, FETCH, TOP" in rules
    assert "NULLS FIRST/LAST" in rules
    assert "Do not use TO_NUMBER" in rules
    assert "Do not introduce a CTE just to compute a casted field" in rules
    assert "Partition fields are view-specific" in rules
    assert "dm_ord_month_city" in rules
    assert "ptstart = '<start_yyyymmdd>'" in rules
    assert "Do not use <, <=, >, >=, or BETWEEN" in rules
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


def test_smart_assignment_conversion_metrics_use_assign_total_conversion_formula():
    instructions = build_denodo_runtime_instructions(
        "统计上个月智能分配线索数、订单数、转化率和转化订单金额",
        [ASSIGN_TOTAL_CONVERSION_TABLE],
        DENODO_CONTEXT_MARKER,
        [],
    )

    formula = instructions[-1]["instruction"]
    assert ASSIGN_TOTAL_CONVERSION_TABLE in formula
    assert 'COUNT(DISTINCT "clew_id")' in formula
    assert (
        'COUNT(DISTINCT CASE WHEN "is_ord_fdpay" = 1 THEN "biz_order_no" END)'
        in formula
    )
    assert 'CAST("actual_price" AS DECIMAL(18, 2))' in formula
    assert (
        "Do not calculate smart-assignment conversion rate as "
        "`converted_order_count / assigned_clew_count`"
    ) in formula
    assert "Do not use `COUNT(*)`" in formula
    assert "`is_ord_pay`" in formula
    assert CONVERSION_CORE_TABLE in formula


def test_smart_assignment_formula_is_not_injected_when_assign_core_is_absent():
    instructions = build_denodo_runtime_instructions(
        "最近三个月智能分配订单转化率",
        [CONVERSION_CORE_TABLE],
        DENODO_CONTEXT_MARKER,
        [],
    )

    assert len(instructions) == 1
    assert "converted_order_count / assigned_clew_count" not in instructions[0][
        "instruction"
    ]


def test_hidden_clew_overview_sql_exemplar_matches_original_question():
    context = get_denodo_hidden_sql_exemplar_context(
        "3月的全量线索大定支付转化率是多少？如果剔除退订订单，大定转化率有什么差别？请同时展示线索量、订单量（含退订）、订单量（不含退订）和对应的转化率。",
        [CLEW_CORE_TABLE, ORD_CORE_TABLE],
        reference_time=datetime(2026, 5, 22),
    )

    assert context
    assert "### INTERNAL HIDDEN SQL EXEMPLAR ###" in context
    assert "202603" in context
    assert "2026-03-01" in context
    assert "2026-03-31" in context
    assert "20260301" in context
    assert "20260401" in context
    assert "leads_per_niche AS" in context
    assert "orders_per_niche AS" in context
    assert "JOIN leads_per_niche l ON o.niche_id = l.niche_id" in context
    assert "WHERE order_date_key >= l.min_clue_date" in context
    assert "LEFT JOIN orders_per_niche o ON l.niche_id = o.niche_id" in context
    assert "o.is_ord_pay" in context
    assert "o.is_ord_fdpay" in context
    assert "gross_order_amount" in context
    assert "paid_flag" in context
    assert "CAST(100 AS DECIMAL(18, 6))" in context
    assert "* 100.0" not in context
    assert "AS FLOAT" not in context
    assert "AS DOUBLE" not in context


def test_hidden_clew_overview_sql_exemplar_matches_month_variants():
    april_context = get_denodo_hidden_sql_exemplar_context(
        "4月的全量线索大定转化率是多少？剔除退订后有什么差别？",
        [CLEW_CORE_TABLE, ORD_CORE_TABLE],
        reference_time=datetime(2026, 5, 22),
    )
    previous_month_context = get_denodo_hidden_sql_exemplar_context(
        "上个月的线索大盘订单转化率是多少？请展示含退订和不含退订转化率。",
        [CLEW_CORE_TABLE, ORD_CORE_TABLE],
        reference_time=datetime(2026, 5, 22),
    )
    february_context = get_denodo_hidden_sql_exemplar_context(
        "2月的全量线索大定支付转化率是多少？如果剔除退订订单，大定转化率有什么差别？",
        [CLEW_CORE_TABLE, ORD_CORE_TABLE],
        reference_time=datetime(2026, 5, 22),
    )

    assert april_context and "202604" in april_context
    assert previous_month_context and "202604" in previous_month_context
    assert february_context and "20260201" in february_context
    assert "20260301" in february_context


def test_hidden_clew_overview_sql_exemplar_does_not_match_other_scopes():
    assert (
        get_denodo_hidden_sql_exemplar_context(
            "3月智能分配全量线索大定转化率是多少？剔除退订后有什么差别？",
            [CLEW_CORE_TABLE, ORD_CORE_TABLE],
            reference_time=datetime(2026, 5, 22),
        )
        is None
    )
    assert (
        get_denodo_hidden_sql_exemplar_context(
            "3月的全量线索大定转化率是多少？剔除退订后有什么差别？",
            [CLEW_CORE_TABLE],
            reference_time=datetime(2026, 5, 22),
        )
        is None
    )


def test_file_backed_metric_formula_instruction_is_injected_when_matched():
    metric_formulas = [
        {
            "id": "denodo_direct_lead_conversion",
            "enabled": True,
            "dataSource": "denodo",
            "name": "直营留资转化指标",
            "scope": {
                "primaryModel": "dv_direct_lead_conversion_core",
                "requiredModels": [],
            },
            "match": {
                "triggerPhrases": ["直营留资"],
                "exampleQuestions": [],
            },
            "metrics": [
                {
                    "name": "conversion_rate",
                    "expression": (
                        'COUNT(DISTINCT CASE WHEN "is_paid" = 1 THEN '
                        '"order_id" END) * 100.0 / '
                        'NULLIF(COUNT(DISTINCT "lead_id"), 0)'
                    ),
                }
            ],
            "forbiddenPatterns": ["COUNT(*)"],
            "extraInstruction": "只能用于直营留资场景。",
        }
    ]

    instructions = build_denodo_runtime_instructions(
        "统计本月直营留资转化率",
        ["dv_direct_lead_conversion_core"],
        DENODO_CONTEXT_MARKER,
        [],
        metric_formulas,
    )

    formula_instruction = instructions[-1]
    assert formula_instruction["instruction_id"] == (
        "denodo_metric_formula:denodo_direct_lead_conversion"
    )
    assert "直营留资转化指标" in formula_instruction["instruction"]
    assert "dv_direct_lead_conversion_core" in formula_instruction["instruction"]
    assert 'COUNT(DISTINCT CASE WHEN "is_paid" = 1 THEN "order_id" END)' in (
        formula_instruction["instruction"]
    )
    assert "COUNT(*)" in formula_instruction["instruction"]


def test_file_backed_metric_formula_can_match_by_scope_without_trigger_phrase():
    instructions = build_denodo_runtime_instructions(
        "统计本月转化表现",
        ["dv_direct_lead_conversion_core"],
        DENODO_CONTEXT_MARKER,
        [],
        [
            {
                "id": "denodo_direct_lead_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "直营留资转化指标",
                "scope": {
                    "primaryModel": "dv_direct_lead_conversion_core",
                    "requiredModels": [],
                },
                "match": {
                    "triggerPhrases": ["完全不同的业务词"],
                    "exampleQuestions": [],
                },
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "lead_id")',
                    }
                ],
            }
        ],
    )

    assert instructions[-1]["instruction_id"] == (
        "denodo_metric_formula:denodo_direct_lead_conversion"
    )


def test_file_backed_metric_formula_suppresses_builtin_business_formula():
    instructions = build_denodo_runtime_instructions(
        "统计上个月智能分配线索数、订单数、转化率和转化订单金额",
        [ASSIGN_TOTAL_CONVERSION_TABLE],
        DENODO_CONTEXT_MARKER,
        [],
        [
            {
                "id": "denodo_assign_total_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "智能分配转化指标",
                "scope": {
                    "primaryModel": ASSIGN_TOTAL_CONVERSION_TABLE,
                    "requiredModels": [],
                },
                "match": {"triggerPhrases": []},
                "metrics": [
                    {
                        "name": "total_amount",
                        "expression": (
                            'COALESCE(SUM(CASE WHEN "is_conver_order" = 1 THEN '
                            'CAST("actual_price" AS DECIMAL(18, 2)) END), 0)'
                        ),
                    }
                ],
            }
        ],
    )

    instruction_ids = [instruction["instruction_id"] for instruction in instructions]
    assert DENODO_BUSINESS_FORMULA_INSTRUCTION_ID not in instruction_ids
    assert instructions[-1]["instruction_id"] == (
        "denodo_metric_formula:denodo_assign_total_conversion"
    )
    assert "is_conver_order" in instructions[-1]["instruction"]
    assert "is_ord_fdpay" not in instructions[-1]["instruction"]


def test_file_backed_package_order_metric_formula_is_injected_by_scope():
    instructions = build_denodo_runtime_instructions(
        "统计上个月最受欢迎的 3 个选装包，并列出平均额外车价增幅",
        ["dv_package_order_core"],
        DENODO_CONTEXT_MARKER,
        [],
        [
            {
                "id": "denodo_package_order_metrics",
                "enabled": True,
                "dataSource": "denodo",
                "name": "选装包订单热度和价格增幅",
                "scope": {
                    "primaryModel": "dv_package_order_core",
                    "requiredModels": [],
                },
                "match": {"triggerPhrases": []},
                "metrics": [
                    {
                        "name": "order_count",
                        "expression": 'COUNT(DISTINCT "biz_order_no")',
                    },
                    {
                        "name": "avg_package_price",
                        "expression": (
                            'ROUND(AVG(CAST("package_price" AS '
                            "DECIMAL(18, 2))), 2)"
                        ),
                    },
                ],
                "forbiddenPatterns": [
                    "dv_ord_core",
                    "city_name",
                    "option_amount",
                    'SUM("order_count")',
                ],
                "extraInstruction": (
                    "按 package_name 分组，Top N 选装包按 order_count 降序、"
                    "package_name 升序稳定排序。"
                ),
            }
        ],
    )

    formula = instructions[-1]["instruction"]
    assert instructions[-1]["instruction_id"] == (
        "denodo_metric_formula:denodo_package_order_metrics"
    )
    assert "dv_package_order_core" in formula
    assert "package_name" in formula
    assert 'COUNT(DISTINCT "biz_order_no")' in formula
    assert 'CAST("package_price" AS DECIMAL(18, 2))' in formula
    assert "dv_ord_core" in formula
    assert "city_name" in formula
    assert "option_amount" in formula


def test_file_backed_metric_formula_is_not_injected_when_scope_is_absent():
    instructions = build_denodo_runtime_instructions(
        "统计本月直营留资转化率",
        ["dv_other_core"],
        DENODO_CONTEXT_MARKER,
        [],
        [
            {
                "id": "denodo_direct_lead_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "直营留资转化指标",
                "scope": {"primaryModel": "dv_direct_lead_conversion_core"},
                "match": {"triggerPhrases": ["直营留资"]},
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "lead_id")',
                    }
                ],
            }
        ],
    )

    assert not any(
        instruction.get("instruction_id")
        == "denodo_metric_formula:denodo_direct_lead_conversion"
        for instruction in instructions
    )


def test_file_backed_metric_formula_requires_required_models():
    instructions = build_denodo_runtime_instructions(
        "统计线索大盘的线索量、订单数、订单转化率和转化订单金额。",
        ["dv_clew_core"],
        DENODO_CONTEXT_MARKER,
        [],
        [
            {
                "id": "denodo_clew_overview_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "线索大盘转化指标",
                "scope": {
                    "primaryModel": "dv_clew_core",
                    "requiredModels": ["dv_ord_core"],
                },
                "match": {"triggerPhrases": ["线索大盘"]},
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            }
        ],
    )

    assert not any(
        instruction.get("instruction_id")
        == "denodo_metric_formula:denodo_clew_overview_conversion"
        for instruction in instructions
    )


def test_metric_formula_matches_schema_qualified_primary_model():
    instructions = build_denodo_runtime_instructions(
        "上月各城市通过智能分配试驾的线索转化效果如何？按城市统计试驾量、成单数和转化率。",
        ["dv_niche_ord_conversion_core"],
        DENODO_CONTEXT_MARKER,
        [],
        [
            {
                "id": "denodo_niche_drive_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "智能分配试驾转化指标",
                "scope": {
                    "primaryModel": "admin.dv_niche_ord_conversion_core",
                    "requiredModels": [],
                },
                "match": {"triggerPhrases": ["智能分配试驾", "试驾转化率"]},
                "metrics": [
                    {
                        "name": "drive_conversion_rate",
                        "expression": (
                            'ROUND(COUNT(DISTINCT CASE WHEN '
                            '"ai_assign_drive_cnt" > 0 AND "is_ord_fdpay" = 1 '
                            'THEN "biz_order_no" END) * 100.0 / '
                            'NULLIF(COUNT(DISTINCT CASE WHEN '
                            '"ai_assign_drive_cnt" > 0 THEN "clew_id" END), 0), 2)'
                        ),
                    }
                ],
            }
        ],
    )

    assert instructions[-1]["instruction_id"] == (
        "denodo_metric_formula:denodo_niche_drive_conversion"
    )
    assert "admin.dv_niche_ord_conversion_core" in instructions[-1]["instruction"]
    assert "ai_assign_drive_cnt" in instructions[-1]["instruction"]


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
    assert "never as range predicates" in instruction
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
