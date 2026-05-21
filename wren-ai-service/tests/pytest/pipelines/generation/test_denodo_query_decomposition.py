from src.pipelines.generation.denodo_query_decomposition import (
    construct_instruction_texts,
    denodo_query_decomposition_system_prompt,
    denodo_query_decomposition_user_prompt_template,
    format_query_decomposition_context,
    format_validated_subquery_drafts,
    normalize_denodo_query_decomposition,
)


def test_normalize_complex_denodo_decomposition():
    result = normalize_denodo_query_decomposition(
        {
            "complexity": "complex",
            "subqueries": [
                {
                    "cteName": "sales_by_series",
                    "objective": "count orders by model series",
                    "grain": "series",
                    "joinKeys": ["series"],
                    "outputColumns": ["series", "order_count"],
                },
                {
                    "cte_name": "colors_by_series",
                    "objective": "count exterior colors by model series",
                    "grain": "series + exterior_color",
                    "join_keys": ["series"],
                    "output_columns": ["series", "exterior_color", "color_count"],
                },
            ],
            "finalAssembly": "join by series",
        },
        max_subqueries=3,
    )

    assert result["complexity"] == "complex"
    assert [item["cte_name"] for item in result["subqueries"]] == [
        "sales_by_series",
        "colors_by_series",
    ]
    assert result["final_assembly"] == "join by series"


def test_normalize_falls_back_to_simple_when_subquery_count_is_invalid():
    result = normalize_denodo_query_decomposition(
        {
            "complexity": "complex",
            "subqueries": [
                {
                    "cte_name": "only_one",
                    "objective": "single step",
                }
            ],
        },
        max_subqueries=3,
    )

    assert result == {
        "complexity": "simple",
        "subqueries": [],
        "final_assembly": "",
    }


def test_format_validated_subquery_drafts_keeps_internal_sql_context():
    formatted = format_validated_subquery_drafts(
        {"final_assembly": "join by series and order by order_count desc"},
        [
            {
                "subquery": {
                    "cte_name": "sales_by_series",
                    "objective": "count orders by series",
                    "grain": "series",
                    "join_keys": ["series"],
                    "output_columns": ["series", "order_count"],
                },
                "sql": (
                    'SELECT "series", COUNT(*) AS "order_count" '
                    'FROM orders GROUP BY "series"'
                ),
            }
        ],
    )

    assert "Final assembly: join by series" in formatted
    assert "Subquery 1: sales_by_series" in formatted
    assert "Internal VQL draft:" in formatted
    assert "must still pass Denodo MCP validation" in formatted
    assert "order_count" in formatted


def test_format_query_decomposition_context_excludes_internal_sql():
    formatted = format_query_decomposition_context(
        {
            "complexity": "complex",
            "final_assembly": "join by series",
            "subqueries": [
                {
                    "cte_name": "sales_by_series",
                    "objective": "count orders by series",
                    "grain": "series",
                    "join_keys": ["series"],
                    "output_columns": ["series", "order_count"],
                }
            ],
        }
    )

    assert "Final assembly: join by series" in formatted
    assert "Subquery 1: sales_by_series" in formatted
    assert "count orders by series" in formatted
    assert "Internal VQL draft" not in formatted
    assert "SELECT" not in formatted


def test_construct_instruction_texts_supports_instruction_documents():
    assert construct_instruction_texts(
        [
            {"instruction": "use Denodo-safe syntax"},
            {"text": "ignored"},
            "preserve business metric scope",
        ]
    ) == ["use Denodo-safe syntax", "preserve business metric scope"]


def test_denodo_decomposition_prompt_mentions_q20_decline_pattern():
    prompt_text = (
        denodo_query_decomposition_system_prompt
        + denodo_query_decomposition_user_prompt_template
    )

    assert "Top-N population" in prompt_text
    assert "three consecutive months" in prompt_text
    assert "self-join" in prompt_text
    assert "month_index" in prompt_text
    assert "LAG/LEAD" in prompt_text
