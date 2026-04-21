from src.pipelines.generation.sql_answer import sql_to_answer_system_prompt


def test_sql_answer_prompt_defaults_to_analyst_sections():
    assert "Conclusion" in sql_to_answer_system_prompt
    assert "Change Magnitude" in sql_to_answer_system_prompt
    assert "Possible Reasons" in sql_to_answer_system_prompt
    assert "Data Gaps" in sql_to_answer_system_prompt


def test_sql_answer_prompt_avoids_unsupported_reasoning():
    assert "Do not invent business explanations" in sql_to_answer_system_prompt
    assert "grounded in the provided data" in sql_to_answer_system_prompt
