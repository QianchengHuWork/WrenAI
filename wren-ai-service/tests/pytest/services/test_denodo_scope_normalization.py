from src.web.v1.services.denodo_scope_normalization import (
    ScopedCanonicalValueDictionary,
    filter_dictionary_entries,
    validate_query_normalization_result,
)


def test_filter_dictionary_entries_drops_unsafe_single_char_aliases():
    dictionary = ScopedCanonicalValueDictionary.model_validate(
        {
            "entries": [
                {
                    "scope": {"model": "dm_ord_day_status", "column": "paid_flag"},
                    "canonicalValue": "1",
                    "aliases": ["是", "已支付", "true"],
                },
                {
                    "scope": {"model": "dm_ord_day_status", "column": "refund_flag"},
                    "canonicalValue": "0",
                    "aliases": ["否", "未退款"],
                },
            ]
        }
    )

    entries = filter_dictionary_entries(dictionary, models=["dm_ord_day_status"])

    assert [entry.aliases for entry in entries] == [["已支付", "true"], ["未退款"]]


def test_validate_query_normalization_result_rejects_unsafe_single_char_alias_rewrite():
    entries = ScopedCanonicalValueDictionary.model_validate(
        {
            "entries": [
                {
                    "scope": {"model": "dm_ord_day_status", "column": "paid_flag"},
                    "canonicalValue": "1",
                    "aliases": ["是", "已支付"],
                }
            ]
        }
    ).entries
    query = '根据订单日期，统计今年一季度，全量订单表里状态包含"已完成"的订单总金额是多少?'

    normalized_query, rewrites = validate_query_normalization_result(
        payload={
            "normalized_query": '根据订单日期，统计今年一季度，全量订单表里状态包含"已完成"的订单总金额1多少?',
            "matched_rewrites": [
                {
                    "scope": {"model": "dm_ord_day_status", "column": "paid_flag"},
                    "user_phrase": "是",
                    "canonical_value": "1",
                }
            ],
        },
        query=query,
        entries=entries,
    )

    assert normalized_query == query
    assert rewrites == []


def test_validate_query_normalization_result_rejects_unlisted_alias_for_scope():
    entries = ScopedCanonicalValueDictionary.model_validate(
        {
            "entries": [
                {
                    "scope": {"model": "dm_ord_day_status", "column": "refund_flag"},
                    "canonicalValue": "1",
                    "aliases": ["已退款", "退款完成"],
                }
            ]
        }
    ).entries
    query = '根据订单日期，统计今年一季度，状态包含"已完成"的订单总金额是多少?'

    normalized_query, rewrites = validate_query_normalization_result(
        payload={
            "normalized_query": '根据订单日期，统计今年一季度，状态包含"1"的订单总金额是多少?',
            "matched_rewrites": [
                {
                    "scope": {"model": "dm_ord_day_status", "column": "refund_flag"},
                    "user_phrase": "已完成",
                    "canonical_value": "1",
                }
            ],
        },
        query=query,
        entries=entries,
    )

    assert normalized_query == query
    assert rewrites == []


def test_validate_query_normalization_result_keeps_natural_language_paraphrase_without_rewrites():
    entries = ScopedCanonicalValueDictionary.model_validate(
        {
            "entries": [
                {
                    "scope": {"model": "dm_ord_day_status", "column": "delivered_flag"},
                    "canonicalValue": "1",
                    "aliases": ["是", "true", "已开启"],
                },
                {
                    "scope": {"model": "dm_ord_day_status", "column": "paid_flag"},
                    "canonicalValue": "1",
                    "aliases": ["是", "true", "已开启"],
                },
                {
                    "scope": {"model": "dm_ord_day_status", "column": "refund_flag"},
                    "canonicalValue": "0",
                    "aliases": ["否", "false", "未开启"],
                },
            ]
        }
    ).entries
    query = "根据订单日期，统计今年一季度，订单里已经交车且客户已经付了款、而且没有退款的订单总金额是多少？"
    paraphrased = (
        "根据订单日期，统计今年一季度，订单里已进入交付口径且已支付且未退款的订单总金额是多少？"
    )

    normalized_query, rewrites = validate_query_normalization_result(
        payload={
            "normalized_query": paraphrased,
            "matched_rewrites": [],
        },
        query=query,
        entries=entries,
    )

    assert normalized_query == paraphrased
    assert rewrites == []
