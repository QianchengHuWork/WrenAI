from src.pipelines.generation.denodo_prompt_context import (
    ASSIGN_TOTAL_CONVERSION_TABLE,
    CLEW_CORE_TABLE,
    DENODO_BUSINESS_FORMULA_INSTRUCTION_ID,
    DENODO_CONTEXT_MARKER,
    DENODO_TECHNICAL_RULES_INSTRUCTION_ID,
    CONVERSION_CORE_TABLE,
    ORDER_CITY_TABLE,
    ORD_CORE_TABLE,
    build_denodo_runtime_instructions,
    is_conversion_rate_query,
    is_lead_overview_conversion_query,
    is_lead_source_conversion_query,
    prioritize_conversion_core_documents,
)
from src.pipelines.generation.scope_resolution import scope_resolution_user_prompt_template
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


def test_detect_lead_source_conversion_query():
    assert is_lead_source_conversion_query(
        "按线索四级来源目录统计今年累计的线索量和对应的订单转化率，列出转化率最高的前 5 个来源渠道。"
    )
    assert not is_lead_source_conversion_query(
        "按智能分配渠道统计今年累计的线索量和订单转化率"
    )


def test_detect_lead_overview_conversion_query():
    assert is_lead_overview_conversion_query(
        "3月的全量线索大定支付转化率是多少？如果剔除退订订单，大定转化率有什么差别？"
    )
    assert not is_lead_overview_conversion_query(
        "统计3月智能分配线索大定支付转化率"
    )


def test_scope_resolution_prompt_distinguishes_general_lead_from_smart_assignment():
    assert "all-leads" in scope_resolution_user_prompt_template
    assert "large-deposit payment conversion rate" in (
        scope_resolution_user_prompt_template
    )
    assert "fourth-level source" in scope_resolution_user_prompt_template
    assert "primary_model = dv_clew_core" in scope_resolution_user_prompt_template
    assert 'secondary_models = ["dv_ord_core"]' in scope_resolution_user_prompt_template
    assert "Do not choose `dv_assign_total_conversion_core`" in (
        scope_resolution_user_prompt_template
    )
    assert "assign_year_month" in scope_resolution_user_prompt_template
    assert "channel_id" in scope_resolution_user_prompt_template


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


def test_prioritize_lead_source_conversion_documents_before_metric_formula_order():
    documents = [
        {
            "table_name": ASSIGN_TOTAL_CONVERSION_TABLE,
            "table_ddl": "smart assignment conversion ddl",
        },
        {"table_name": ORD_CORE_TABLE, "table_ddl": "order ddl"},
        {"table_name": CLEW_CORE_TABLE, "table_ddl": "lead ddl"},
    ]

    prioritized = prioritize_conversion_core_documents(
        "按线索四级来源目录统计今年累计的线索量和对应的订单转化率，列出转化率最高的前 5 个来源渠道。",
        documents,
        [
            {
                "id": "denodo_assign_total_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "智能分配转化指标",
                "scope": {"primaryModel": ASSIGN_TOTAL_CONVERSION_TABLE},
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            },
            {
                "id": "denodo_clew_overview_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "线索大盘转化指标",
                "scope": {
                    "primaryModel": CLEW_CORE_TABLE,
                    "requiredModels": [ORD_CORE_TABLE],
                },
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            },
        ],
    )

    assert [document["table_name"] for document in prioritized[:2]] == [
        CLEW_CORE_TABLE,
        ORD_CORE_TABLE,
    ]


def test_prioritize_lead_overview_conversion_documents_before_assign_formula():
    documents = [
        {
            "table_name": ASSIGN_TOTAL_CONVERSION_TABLE,
            "table_ddl": "smart assignment conversion ddl",
        },
        {"table_name": ORD_CORE_TABLE, "table_ddl": "order ddl"},
        {"table_name": CLEW_CORE_TABLE, "table_ddl": "lead ddl"},
    ]

    prioritized = prioritize_conversion_core_documents(
        "3月的全量线索大定支付转化率是多少？如果剔除退订订单，大定转化率有什么差别？",
        documents,
        [
            {
                "id": "denodo_assign_total_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "智能分配转化指标",
                "scope": {"primaryModel": ASSIGN_TOTAL_CONVERSION_TABLE},
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            },
            {
                "id": "denodo_clew_overview_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "线索大盘转化指标",
                "scope": {
                    "primaryModel": CLEW_CORE_TABLE,
                    "requiredModels": [ORD_CORE_TABLE],
                },
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            },
        ],
    )

    assert [document["table_name"] for document in prioritized[:2]] == [
        CLEW_CORE_TABLE,
        ORD_CORE_TABLE,
    ]


def test_prioritize_smart_assignment_conversion_documents():
    documents = [
        {
            "table_name": CONVERSION_CORE_TABLE,
            "table_ddl": "generic conversion ddl",
        },
        {
            "table_name": "dm_conversion_month_strategy",
            "table_ddl": "strategy aggregate ddl",
        },
        {
            "table_name": ASSIGN_TOTAL_CONVERSION_TABLE,
            "table_ddl": "smart assignment conversion ddl",
        },
    ]

    prioritized = prioritize_conversion_core_documents(
        "统计上个月智能分配线索数、订单数、转化率和转化订单金额",
        documents,
    )

    assert prioritized[0]["table_name"] == ASSIGN_TOTAL_CONVERSION_TABLE


def test_file_backed_metric_formula_prioritizes_primary_document():
    documents = [
        {"table_name": CONVERSION_CORE_TABLE, "table_ddl": "generic conversion ddl"},
        {
            "table_name": "dv_direct_lead_conversion_core",
            "table_ddl": "direct lead ddl",
        },
    ]

    prioritized = prioritize_conversion_core_documents(
        "统计本月转化表现",
        documents,
        [
            {
                "id": "denodo_direct_lead_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "直营留资转化指标",
                "scope": {"primaryModel": "dv_direct_lead_conversion_core"},
                "match": {"triggerPhrases": ["完全不同的业务词"]},
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "lead_id")',
                    }
                ],
            }
        ],
    )

    assert prioritized[0]["table_name"] == "dv_direct_lead_conversion_core"


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


def test_smart_assignment_scope_override_selects_assign_total_conversion_core():
    selected = _override_denodo_scope_for_known_patterns(
        "统计上个月智能分配线索数、订单数、转化率和转化订单金额",
        SelectedModels(
            primary_model=CONVERSION_CORE_TABLE,
            secondary_models=[],
            needs_join=False,
            reasoning=["llm selected generic conversion core"],
        ),
        [
            CandidateModelSummary(model=CONVERSION_CORE_TABLE),
            CandidateModelSummary(model=ASSIGN_TOTAL_CONVERSION_TABLE),
            CandidateModelSummary(model="dm_conversion_month_strategy"),
        ],
    )

    assert selected is not None
    assert selected.primary_model == ASSIGN_TOTAL_CONVERSION_TABLE
    assert selected.secondary_models == []
    assert selected.needs_join is False
    assert "smart-assignment conversion metric" in selected.reasoning[0]


def test_file_backed_metric_formula_scope_override_selects_primary_model():
    selected = _override_denodo_scope_for_known_patterns(
        "统计本月直营留资转化率",
        SelectedModels(
            primary_model=CONVERSION_CORE_TABLE,
            secondary_models=[],
            needs_join=False,
            reasoning=["llm selected generic conversion core"],
        ),
        [
            CandidateModelSummary(model=CONVERSION_CORE_TABLE),
            CandidateModelSummary(model="dv_direct_lead_conversion_core"),
        ],
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

    assert selected is not None
    assert selected.primary_model == "dv_direct_lead_conversion_core"
    assert selected.secondary_models == []
    assert selected.needs_join is False
    assert "metric formula" in selected.reasoning[0]


def test_file_backed_metric_formula_scope_override_flips_reversed_models():
    selected = _override_denodo_scope_for_known_patterns(
        "统计线索大盘的线索量、订单数、订单转化率和转化订单金额。",
        SelectedModels(
            primary_model="dv_ord_core",
            secondary_models=["dv_clew_core"],
            needs_join=True,
            reasoning=["llm selected order core first"],
        ),
        [
            CandidateModelSummary(model="dv_ord_core"),
            CandidateModelSummary(model="dv_clew_core"),
        ],
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

    assert selected is not None
    assert selected.primary_model == "dv_clew_core"
    assert selected.secondary_models == ["dv_ord_core"]
    assert selected.needs_join is True


def test_lead_source_scope_override_beats_smart_assignment_formula_candidate():
    selected = _override_denodo_scope_for_known_patterns(
        "按线索四级来源目录统计今年累计的线索量和对应的订单转化率，列出转化率最高的前 5 个来源渠道。",
        SelectedModels(
            primary_model=ASSIGN_TOTAL_CONVERSION_TABLE,
            secondary_models=[],
            needs_join=False,
            reasoning=["llm selected smart assignment core"],
        ),
        [
            CandidateModelSummary(model=ASSIGN_TOTAL_CONVERSION_TABLE),
            CandidateModelSummary(model=CLEW_CORE_TABLE),
            CandidateModelSummary(model=ORD_CORE_TABLE),
        ],
        [
            {
                "id": "denodo_assign_total_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "智能分配转化指标",
                "scope": {"primaryModel": ASSIGN_TOTAL_CONVERSION_TABLE},
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            },
            {
                "id": "denodo_clew_overview_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "线索大盘转化指标",
                "scope": {
                    "primaryModel": CLEW_CORE_TABLE,
                    "requiredModels": [ORD_CORE_TABLE],
                },
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            },
        ],
    )

    assert selected is not None
    assert selected.primary_model == CLEW_CORE_TABLE
    assert selected.secondary_models == [ORD_CORE_TABLE]
    assert selected.needs_join is True
    assert "general lead conversion" in selected.reasoning[0]


def test_lead_overview_scope_override_beats_smart_assignment_formula_candidate():
    selected = _override_denodo_scope_for_known_patterns(
        "3月的全量线索大定支付转化率是多少？如果剔除退订订单，大定转化率有什么差别？",
        SelectedModels(
            primary_model=ASSIGN_TOTAL_CONVERSION_TABLE,
            secondary_models=[],
            needs_join=False,
            reasoning=["llm selected smart assignment core"],
        ),
        [
            CandidateModelSummary(model=ASSIGN_TOTAL_CONVERSION_TABLE),
            CandidateModelSummary(model=CLEW_CORE_TABLE),
            CandidateModelSummary(model=ORD_CORE_TABLE),
        ],
        [
            {
                "id": "denodo_assign_total_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "智能分配转化指标",
                "scope": {"primaryModel": ASSIGN_TOTAL_CONVERSION_TABLE},
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            },
            {
                "id": "denodo_clew_overview_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "线索大盘转化指标",
                "scope": {
                    "primaryModel": CLEW_CORE_TABLE,
                    "requiredModels": [ORD_CORE_TABLE],
                },
                "metrics": [
                    {
                        "name": "conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            },
        ],
    )

    assert selected is not None
    assert selected.primary_model == CLEW_CORE_TABLE
    assert selected.secondary_models == [ORD_CORE_TABLE]
    assert selected.needs_join is True
    assert "general lead conversion" in selected.reasoning[0]


def test_metric_formula_scope_override_resolves_schema_qualified_model():
    selected = _override_denodo_scope_for_known_patterns(
        "上月各城市通过智能分配试驾的线索转化效果如何？按城市统计试驾量、成单数和转化率。",
        SelectedModels(
            primary_model="dv_assign_total_conversion_core",
            secondary_models=[],
            needs_join=False,
            reasoning=["llm selected smart assignment aggregate"],
        ),
        [
            CandidateModelSummary(model="dv_assign_total_conversion_core"),
            CandidateModelSummary(model="dv_niche_ord_conversion_core"),
        ],
        [
            {
                "id": "denodo_niche_drive_conversion",
                "enabled": True,
                "dataSource": "denodo",
                "name": "智能分配试驾转化指标",
                "scope": {"primaryModel": "admin.dv_niche_ord_conversion_core"},
                "match": {"triggerPhrases": ["智能分配试驾", "试驾转化率"]},
                "metrics": [
                    {
                        "name": "drive_conversion_rate",
                        "expression": 'COUNT(DISTINCT "clew_id")',
                    }
                ],
            }
        ],
    )

    assert selected is not None
    assert selected.primary_model == "dv_niche_ord_conversion_core"
    assert selected.secondary_models == []
    assert selected.needs_join is False


def test_smart_assignment_scope_override_does_not_force_missing_assign_core():
    original = SelectedModels(
        primary_model=CONVERSION_CORE_TABLE,
        secondary_models=[],
        needs_join=False,
    )

    selected = _override_denodo_scope_for_known_patterns(
        "统计上个月智能分配线索数、订单数、转化率和转化订单金额",
        original,
        [
            CandidateModelSummary(model=CONVERSION_CORE_TABLE),
            CandidateModelSummary(model="dm_conversion_month_strategy"),
        ],
    )

    assert selected == original
