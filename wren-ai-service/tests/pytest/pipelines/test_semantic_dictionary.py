from src.pipelines.generation.semantic_dictionary import validated


def test_semantic_dictionary_validated_keeps_known_task_ids_and_filters_unknown():
    tasks = [
        {
            "taskId": "dv_ord_core.order_status.COLUMN_HINT",
            "scope": {"model": "dv_ord_core", "column": "order_status"},
            "rewriteMode": "COLUMN_HINT",
        },
        {
            "taskId": "dv_ord_core.order_status.VALUE_ALIAS",
            "scope": {"model": "dv_ord_core", "column": "order_status"},
            "rewriteMode": "VALUE_ALIAS",
        },
    ]

    result = validated(
        normalized={
            "items": [
                {
                    "taskId": "dv_ord_core.order_status.COLUMN_HINT",
                    "concept": "订单履约状态",
                    "aliases": ["订单状态", "履约状态"],
                },
                {
                    "taskId": "dv_ord_core.order_status.VALUE_ALIAS",
                    "concept": "订单履约状态",
                    "valueMappings": [
                        {
                            "canonicalValue": "已完成",
                            "aliases": ["已交付", "交付完成"],
                        }
                    ],
                },
                {
                    "taskId": "missing.task",
                    "concept": "无效任务",
                    "aliases": ["无效"],
                },
            ]
        },
        tasks=tasks,
    )

    assert result == {
        "items": [
            {
                "taskId": "dv_ord_core.order_status.COLUMN_HINT",
                "concept": "订单履约状态",
                "description": None,
                "aliases": ["订单状态", "履约状态"],
                "valueMappings": [],
            },
            {
                "taskId": "dv_ord_core.order_status.VALUE_ALIAS",
                "concept": "订单履约状态",
                "description": None,
                "aliases": [],
                "valueMappings": [
                    {
                        "canonicalValue": "已完成",
                        "aliases": ["已交付", "交付完成"],
                        "description": None,
                    }
                ],
            },
        ]
    }


def test_semantic_dictionary_validated_backfills_task_id_from_legacy_shape():
    tasks = [
        {
            "taskId": "dv_ord_core.order_status.VALUE_ALIAS",
            "scope": {"model": "dv_ord_core", "column": "order_status"},
            "rewriteMode": "VALUE_ALIAS",
        }
    ]

    result = validated(
        normalized={
            "items": [
                {
                    "model": "dv_ord_core",
                    "column": "order_status",
                    "rewriteMode": "VALUE_ALIAS",
                    "canonicalValue": "已完成",
                    "aliases": ["已交付"],
                }
            ]
        },
        tasks=tasks,
    )

    assert result == {
        "items": [
            {
                "taskId": "dv_ord_core.order_status.VALUE_ALIAS",
                "concept": None,
                "description": None,
                "aliases": ["已交付"],
                "valueMappings": [
                    {
                        "canonicalValue": "已完成",
                        "aliases": ["已交付"],
                        "description": None,
                    }
                ],
            }
        ]
    }
