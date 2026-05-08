from src.pipelines.generation.utils.sql import (
    get_text_to_sql_rules,
    sql_generation_reasoning_system_prompt,
)


def test_text_to_sql_rules_do_not_require_dense_rank():
    rules = get_text_to_sql_rules()

    assert "you must use the ranking function, `DENSE_RANK()`" not in rules
    assert "DO NOT assume `DENSE_RANK()`" in rules
    assert "prefer `ORDER BY ... LIMIT`" in rules


def test_text_to_sql_rules_prefer_float_for_rates():
    rules = get_text_to_sql_rules()

    assert "conversion rate" in rules
    assert "cast both numerator and denominator to FLOAT" in rules
    assert "Use NULLIF on the denominator" in rules
    assert "Do NOT use bare CAST(... AS DECIMAL)" in rules
    assert "Keep DECIMAL for monetary amount calculations" in rules


def test_reasoning_prompt_does_not_require_dense_rank():
    assert (
        "you must use the ranking function, `DENSE_RANK()`"
        not in sql_generation_reasoning_system_prompt
    )
    assert "do not assume `DENSE_RANK()`" in sql_generation_reasoning_system_prompt
    assert "Only add a ranking column" in sql_generation_reasoning_system_prompt
