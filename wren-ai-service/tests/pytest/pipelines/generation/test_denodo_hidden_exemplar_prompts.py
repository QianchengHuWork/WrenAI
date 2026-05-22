from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_correction import (
    prompt as sql_correction_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    prompt as sql_generation_prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.sql_generation_reasoning import (
    prompt as sql_generation_reasoning_prompt,
    sql_generation_reasoning_user_prompt_template,
)


def test_hidden_sql_exemplar_is_in_final_generation_prompt_only():
    hidden_context = "### INTERNAL HIDDEN SQL EXEMPLAR ###\nSELECT 1 AS hidden_sql"

    final_prompt = sql_generation_prompt(
        query="3月的全量线索大定支付转化率是多少？如果剔除退订订单，大定转化率有什么差别？",
        documents=['CREATE VIEW "dv_clew_core" AS SELECT ...'],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        hidden_sql_exemplar_context=hidden_context,
    )["prompt"]
    reasoning_prompt = sql_generation_reasoning_prompt(
        query="3月的全量线索大定支付转化率是多少？如果剔除退订订单，大定转化率有什么差别？",
        documents=['CREATE VIEW "dv_clew_core" AS SELECT ...'],
        sql_samples=[],
        instructions=[],
        semantic_context=None,
        prompt_builder=PromptBuilder(
            template=sql_generation_reasoning_user_prompt_template
        ),
    )["prompt"]

    assert "INTERNAL HIDDEN SQL EXEMPLAR" in final_prompt
    assert "SELECT 1 AS hidden_sql" in final_prompt
    assert "INTERNAL HIDDEN SQL EXEMPLAR" not in reasoning_prompt
    assert "SELECT 1 AS hidden_sql" not in reasoning_prompt


def test_hidden_sql_exemplar_is_in_correction_prompt():
    hidden_context = "### INTERNAL HIDDEN SQL EXEMPLAR ###\nSELECT 1 AS hidden_sql"

    correction_prompt = sql_correction_prompt(
        documents=['CREATE VIEW "dv_clew_core" AS SELECT ...'],
        invalid_generation_result={
            "sql": "SELECT bad_sql",
            "error": "round(double precision, integer)",
        },
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
        hidden_sql_exemplar_context=hidden_context,
    )["prompt"]

    assert "INTERNAL HIDDEN SQL EXEMPLAR" in correction_prompt
    assert "SELECT 1 AS hidden_sql" in correction_prompt
    assert "round(double precision, integer)" in correction_prompt
    assert "DECIMAL(18, 6)" in correction_prompt
