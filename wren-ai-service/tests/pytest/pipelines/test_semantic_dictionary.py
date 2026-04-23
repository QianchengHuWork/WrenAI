from src.pipelines.generation.semantic_dictionary import validated


def test_semantic_dictionary_validated_keeps_known_task_ids_and_filters_unknown():
    tasks = [
        {
            "taskId": "dv_ord_core.order_status.已完成",
            "scope": {"model": "dv_ord_core", "column": "order_status"},
            "canonicalValue": "已完成",
        },
        {
            "taskId": "dv_ord_core.is_paid.1",
            "scope": {"model": "dv_ord_core", "column": "is_paid"},
            "canonicalValue": "1",
        },
    ]

    result = validated(
        normalized={
            "items": [
                {
                    "taskId": "dv_ord_core.order_status.已完成",
                    "description": "订单已完成状态",
                    "aliases": ["已交付", "交付完成"],
                },
                {
                    "taskId": "dv_ord_core.is_paid.1",
                    "aliases": ["付款成功", "支付完成"],
                },
                {
                    "taskId": "missing.task",
                    "aliases": ["无效"],
                },
            ]
        },
        tasks=tasks,
    )

    assert result == {
        "items": [
            {
                "taskId": "dv_ord_core.order_status.已完成",
                "description": "订单已完成状态",
                "aliases": ["已交付", "交付完成"],
            },
            {
                "taskId": "dv_ord_core.is_paid.1",
                "description": None,
                "aliases": ["付款成功", "支付完成"],
            },
        ]
    }


def test_semantic_dictionary_validated_filters_blank_aliases():
    tasks = [
        {
            "taskId": "dv_ord_core.order_status.已完成",
            "scope": {"model": "dv_ord_core", "column": "order_status"},
            "canonicalValue": "已完成",
        }
    ]

    result = validated(
        normalized={
            "items": [
                {
                    "taskId": "dv_ord_core.order_status.已完成",
                    "aliases": ["已交付", "  ", "已交付", None],
                }
            ]
        },
        tasks=tasks,
    )

    assert result == {
        "items": [
            {
                "taskId": "dv_ord_core.order_status.已完成",
                "description": None,
                "aliases": ["已交付"],
            }
        ]
    }
