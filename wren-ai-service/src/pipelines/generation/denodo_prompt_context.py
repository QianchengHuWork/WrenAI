import re
from collections.abc import Iterable
from typing import Any

from src.core.engine import clean_generation_result
from src.utils import loads_llm_json

DENODO_CONTEXT_MARKER = "[[WREN_DENODO_CONTEXT]]"
DENODO_TECHNICAL_RULES_INSTRUCTION_ID = "denodo_vql_technical_rules"
DENODO_BUSINESS_FORMULA_INSTRUCTION_ID = "denodo_business_formula_rules"
DENODO_TEMPORAL_TOPN_DECLINE_INSTRUCTION_ID = "denodo_temporal_topn_decline_rules"

CONVERSION_CORE_TABLE = "dv_clew_ord_conversion_core"
ORDER_CITY_TABLE = "dm_ord_month_city"
TOTAL_CLEW_TABLE = "dv_clew_total_core"

SMART_ASSIGNMENT_CONVERSION_TABLES = {
    CONVERSION_CORE_TABLE,
    "dm_conversion_month_strategy",
}
TOTAL_CLEW_TABLES = {
    TOTAL_CLEW_TABLE,
    "dm_clew_month_overview",
    "dm_clew_month_overview_curated",
}

_CONVERSION_RATE_QUERY_PATTERNS = [
    re.compile(r"转化率"),
    re.compile(r"转化趋势"),
    re.compile(r"环比.{0,6}转化"),
    re.compile(r"转化.{0,6}环比"),
    re.compile(r"conversion rate", re.IGNORECASE),
    re.compile(r"conversion trend", re.IGNORECASE),
    re.compile(r"month[- ]over[- ]month.{0,10}conversion", re.IGNORECASE),
]
_SMART_ASSIGNMENT_CONTEXT_PATTERNS = [
    re.compile(r"智能分配"),
    re.compile(r"分配后"),
    re.compile(r"已分配"),
    re.compile(r"分配策略"),
    re.compile(r"策略转化"),
    re.compile(r"assigned", re.IGNORECASE),
    re.compile(r"assignment", re.IGNORECASE),
    re.compile(r"post[- ]assignment", re.IGNORECASE),
    re.compile(r"strategy", re.IGNORECASE),
]
_ASSIGNED_COVERAGE_PATTERNS = [
    re.compile(r"智能分配.{0,8}覆盖率"),
    re.compile(r"分配.{0,8}覆盖率"),
    re.compile(r"coverage", re.IGNORECASE),
]
_ASSIGN_SUCCESS_PATTERNS = [
    re.compile(r"分配成功率"),
    re.compile(r"assign success", re.IGNORECASE),
    re.compile(r"assignment success", re.IGNORECASE),
]
_CITY_PATTERNS = [
    re.compile(r"城市"),
    re.compile(r"city", re.IGNORECASE),
]
_ORDER_AMOUNT_PATTERNS = [
    re.compile(r"订单金额"),
    re.compile(r"order amount", re.IGNORECASE),
    re.compile(r"amount", re.IGNORECASE),
]
_TOP_N_PATTERNS = [
    re.compile(r"前\s*\d+"),
    re.compile(r"top\s*\d+", re.IGNORECASE),
    re.compile(r"排名"),
]
_MONTH_TREND_PATTERNS = [
    re.compile(r"连续"),
    re.compile(r"下降"),
    re.compile(r"月份"),
    re.compile(r"环比"),
    re.compile(r"consecutive", re.IGNORECASE),
    re.compile(r"declin", re.IGNORECASE),
    re.compile(r"month", re.IGNORECASE),
]


def is_denodo_context(semantic_context: str | None) -> bool:
    return bool(semantic_context and DENODO_CONTEXT_MARKER in semantic_context)


def is_conversion_rate_query(query: str) -> bool:
    normalized = query.strip()
    if not normalized:
        return False

    if any(pattern.search(normalized) for pattern in _CONVERSION_RATE_QUERY_PATTERNS):
        return True

    lowered = normalized.lower()
    return "conversion" in lowered and (
        "mom" in lowered
        or "month over month" in lowered
        or "month-over-month" in lowered
        or "trend" in lowered
    )


def is_city_conversion_rate_query(query: str) -> bool:
    normalized = query.strip()
    return is_conversion_rate_query(normalized) and any(
        pattern.search(normalized) for pattern in _CITY_PATTERNS
    )


def is_top_city_order_amount_query(query: str) -> bool:
    normalized = query.strip()
    return (
        any(pattern.search(normalized) for pattern in _CITY_PATTERNS)
        and any(pattern.search(normalized) for pattern in _ORDER_AMOUNT_PATTERNS)
        and any(pattern.search(normalized) for pattern in _TOP_N_PATTERNS)
    )


def is_consecutive_month_decline_query(query: str) -> bool:
    normalized = query.strip()
    if not normalized:
        return False

    lowered = normalized.lower()
    has_consecutive_decline = (
        ("连续" in normalized and "下降" in normalized)
        or ("consecutive" in lowered and "declin" in lowered)
    )
    has_month_context = (
        "月" in normalized
        or "month" in lowered
        or any(pattern.search(normalized) for pattern in _MONTH_TREND_PATTERNS)
    )
    return has_consecutive_decline and has_month_context


def is_denodo_q20_city_conversion_decline_query(query: str) -> bool:
    return (
        is_city_conversion_rate_query(query)
        and is_top_city_order_amount_query(query)
        and is_consecutive_month_decline_query(query)
    )


def prioritize_conversion_core_documents(
    query: str, documents: list[dict]
) -> list[dict]:
    if not is_conversion_rate_query(query):
        return documents

    q20_like = is_denodo_q20_city_conversion_decline_query(query)
    return sorted(
        documents,
        key=(
            _document_priority_for_city_conversion_decline
            if q20_like
            else _document_priority_for_conversion
        ),
    )


def _document_priority_for_conversion(document: dict) -> int:
    return 0 if document.get("table_name") == CONVERSION_CORE_TABLE else 1


def _document_priority_for_city_conversion_decline(document: dict) -> int:
    table_name = document.get("table_name")
    if table_name == CONVERSION_CORE_TABLE:
        return 0
    if table_name == ORDER_CITY_TABLE:
        return 1
    return 2


def get_denodo_technical_rules() -> str:
    return (
        "For Denodo VQL generation and correction:\n"
        "1. Output Denodo-compatible VQL only. Always wrap table names, column "
        "names, and alias-qualified columns in double quotes.\n"
        "2. Do not generate LIMIT, FETCH, TOP, OFFSET, or NULLS FIRST/LAST. For "
        "simple final-display top/bottom questions, use final ORDER BY only and "
        "rely on the caller-side result limit.\n"
        "3. Do not use LIMIT or FETCH inside subqueries or CTEs.\n"
        "4. Prefer semantic date fields such as *_year, *_month, and *_date over "
        "casting raw date strings. Avoid DATE_TRUNC, TO_CHAR, INTERVAL, "
        "SUBSTRING, and LENGTH unless the retrieved schema or an existing sample "
        "proves the function is supported.\n"
        "5. Do not put aggregate expressions in WHERE. Use HAVING after "
        "aggregation, and when ordering by an aggregate use the selected alias "
        "where possible.\n"
        "6. Do not use TO_NUMBER in Denodo VQL. For numeric text conversions, "
        "especially monetary amount fields, use CAST(<expression> AS DECIMAL(18, 2)) "
        "inside SUM/AVG or other aggregations.\n"
        "7. Do not introduce a CTE just to compute a casted field, rename fields, "
        "or filter one table. For simple single-view aggregations, inline CAST "
        "inside the aggregate expression. Use CTEs only when they are needed for "
        "mixed grains, top-N per group, or multi-step joins.\n"
        "8. Partition fields are view-specific. Only add `ptstart` and `ptend` "
        "filters to a view when that exact view's retrieved schema includes both "
        "columns. Do not copy `ptstart` or `ptend` filters from one selected view "
        "to another. For `dm_ord_month_city`, use `order_year_month` for month "
        "filtering unless its retrieved schema explicitly lists `ptstart` and "
        "`ptend`.\n"
        "9. Do not add or subtract integers directly from YYYYMM string/month "
        "fields, nor from subqueries that return YYYYMM strings, such as "
        "`(SELECT MAX(order_year_month) ...) - 12`. For fixed relative windows "
        "such as recent 12 months, use concrete YYYYMM lower/upper bounds from "
        "the normalized question/current time. If dynamic month arithmetic is "
        "unavoidable, convert both sides to month_index with SUBSTR+CAST before "
        "doing arithmetic.\n"
        "10. For intermediate Top-N populations that are later joined, filtered, "
        "or analyzed in another CTE, ORDER BY alone is not a filter. Do not use "
        "LIMIT, FETCH, or TOP; use a Denodo-safe correlated-count self filter "
        "with deterministic tie-break fields, for example keep rows where the "
        "count of rows with greater measure or same measure and smaller city "
        "tie-break key is < N.\n"
        "11. Do not use LAG or LEAD for month-over-month, period-over-period, or "
        "consecutive-period comparisons. For YYYYMM fields, create "
        "`month_index = CAST(SUBSTR(month_field, 1, 4) AS INTEGER) * 12 + "
        "CAST(SUBSTR(month_field, 5, 2) AS INTEGER)` and compare adjacent "
        "months with self joins such as m2.month_index = m1.month_index + 1.\n"
        "12. For continuous two-month decline, compare three consecutive months "
        "with self joins: m2.metric < m1.metric and m3.metric < m2.metric. A "
        "single previous-month comparison is not sufficient.\n"
        "13. For rate, ratio, percentage, success-rate, coverage-rate, refund-rate, "
        "share, or numerator/denominator metrics, cast both numerator and "
        "denominator to FLOAT and wrap the denominator with NULLIF(..., 0). Do "
        "not use bare CAST(... AS DECIMAL) for these expressions.\n"
        "14. Do not default to DENSE_RANK or other window ranking functions for "
        "top/bottom questions. Only add ranking when the user explicitly asks "
        "for a rank column or same-rank tie semantics.\n"
        "15. Choose business numerators and denominators from explicit semantic "
        "model definitions, metric definitions, or Denodo business formula "
        "instructions. Do not infer a denominator from a similarly named count "
        "field when the business meaning is ambiguous.\n"
        "16. Only use views and columns present in the retrieved schema context "
        "and selected models. Native VQL schema mapping is only a reference for "
        "those selected views; it does not expand the allowed table set."
    )


def get_denodo_vql_generation_system_prompt() -> str:
    return f"""
You are a Denodo VQL expert. Convert the user's analytics question into one
executable Denodo VQL SELECT query.

Do not generate Wren logical SQL, ANSI-only SQL, or explanatory text. Use the
native Denodo view and column names supplied in the schema/context.

### DENODO VQL RULES ###
{get_denodo_technical_rules()}

### FINAL ANSWER FORMAT ###
The final answer must be JSON only:

{{
    "sql": <DENODO_VQL_QUERY_STRING>
}}
"""


def get_denodo_vql_correction_system_prompt() -> str:
    return f"""
You are a Denodo VQL expert. Fix the invalid Denodo VQL query according to the
error message and return one executable Denodo VQL SELECT query.

Do not convert the query back to Wren logical SQL or generic ANSI-only SQL. Use
native Denodo view and column names supplied in the schema/context.

### DENODO VQL CORRECTION RULES ###
{get_denodo_technical_rules()}

If the validation error says `Function lag is not executable` or rejects a
window function used for consecutive months, rewrite the logic as self joins
over a YYYYMM month_index. Do not try another LAG/LEAD/window variant.

### FINAL ANSWER FORMAT ###
The final answer must be JSON only:

{{
    "sql": <CORRECTED_DENODO_VQL_QUERY_STRING>
}}
"""


def extract_denodo_vql_from_replies(replies: Any) -> str:
    first_reply = replies[0] if isinstance(replies, list) and replies else replies
    cleaned_generation_result = clean_generation_result(first_reply)
    if cleaned_generation_result.startswith("{"):
        cleaned_generation_result = loads_llm_json(cleaned_generation_result)["sql"]
    return cleaned_generation_result.strip()


def build_denodo_vql_post_process_result(replies: Any) -> dict[str, dict[str, Any]]:
    return {
        "valid_generation_result": {
            "sql": extract_denodo_vql_from_replies(replies),
            "correlation_id": "",
        },
        "invalid_generation_result": {},
    }


def get_denodo_business_formula_instructions(
    query: str,
    table_names: Iterable[str | None],
) -> str | None:
    normalized_query = query.strip()
    if not normalized_query:
        return None

    if _is_assign_success_query(normalized_query):
        return (
            "Denodo business formula: for assignment success rate, calculate "
            "`assigned_clew_count / assign_count` with FLOAT casts and NULLIF on "
            "the denominator."
        )

    if _is_assignment_coverage_query(normalized_query):
        return (
            "Denodo business formula: for smart-assignment coverage rate, "
            "calculate `assigned_clew_count / total_clew_count` with FLOAT casts "
            "and NULLIF on the denominator."
        )

    if not is_conversion_rate_query(normalized_query):
        return None

    table_name_set = _normalize_table_names(table_names)
    if _is_smart_assignment_context(normalized_query, table_name_set):
        return (
            "Denodo business formula: when the user asks for smart-assignment, "
            "assigned-lead, post-assignment, or strategy conversion rate, "
            "calculate `converted_order_count / assigned_clew_count` with FLOAT "
            "casts and NULLIF on the denominator."
        )

    total_table_note = (
        "Use the total-leads table or metric in the retrieved context when the "
        "query needs the denominator across all leads."
        if table_name_set & TOTAL_CLEW_TABLES
        else "If `total_clew_count` is not available in the retrieved context, do "
        "not substitute assigned-lead counts as the denominator."
    )
    return (
        "Denodo business formula: for generic order conversion rate, lead-to-order "
        "conversion rate, or overall conversion rate, calculate "
        "`converted_order_count / total_clew_count` with FLOAT casts and NULLIF "
        "on the denominator. Do not use `assigned_clew_count` unless the user "
        "explicitly asks for smart-assignment, assigned-lead, post-assignment, "
        "or strategy conversion rate. "
        f"{total_table_note}"
    )


def get_denodo_temporal_topn_decline_instructions(
    query: str,
    table_names: Iterable[str | None],
) -> str | None:
    if not is_denodo_q20_city_conversion_decline_query(query):
        return None

    table_name_set = _normalize_table_names(table_names)
    required_tables = {CONVERSION_CORE_TABLE, ORDER_CITY_TABLE}
    if not required_tables <= table_name_set:
        return None

    return (
        "Denodo Q20-style structure: for city conversion-rate consecutive-decline "
        f"questions after Top-N order amount filtering, use `{ORDER_CITY_TABLE}` "
        "only to aggregate recent-period city order amount and build the true "
        f"Top-N city set, and use `{CONVERSION_CORE_TABLE}` for monthly city "
        "conversion-rate rows. Filter the "
        f"`{ORDER_CITY_TABLE}` population by `order_year_month`; do not add "
        "`ptstart` or `ptend` to that view unless its retrieved schema explicitly "
        "contains those columns. Use concrete YYYYMM bounds for the recent "
        "period on both `order_year_month` and `clew_year_month`; do not derive "
        "the window with `(SELECT MAX(year_month) ...) - 12` or any direct "
        "arithmetic on raw YYYYMM strings. The Top-N city CTE must actually filter the "
        "population before downstream joins; ORDER BY alone is not valid for an "
        "intermediate Top-N set. Implement the intermediate Top-N with a "
        "Denodo-safe correlated-count filter using total order amount plus "
        "city_code/city_name tie-breaks. For the monthly conversion CTE, create "
        "`month_index` from the YYYYMM month field as "
        "`CAST(SUBSTR(month_field, 1, 4) AS INTEGER) * 12 + "
        "CAST(SUBSTR(month_field, 5, 2) AS INTEGER)`. Detect continuous "
        "two-month decline with three self-joined monthly rows: "
        "m2.month_index = m1.month_index + 1, "
        "m3.month_index = m2.month_index + 1, "
        "m2.conversion_rate < m1.conversion_rate, and "
        "m3.conversion_rate < m2.conversion_rate. Do not use LAG, LEAD, or a "
        "single previous-month comparison. Output city, the three months, the "
        "three rates, both decline amounts, and optionally total decline."
    )


def build_denodo_runtime_instructions(
    query: str,
    table_names: Iterable[str | None],
    semantic_context: str | None,
    instructions: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    runtime_instructions = list(instructions or [])
    if not is_denodo_context(semantic_context):
        return runtime_instructions

    runtime_instructions = _append_instruction_once(
        runtime_instructions,
        instruction_id=DENODO_TECHNICAL_RULES_INSTRUCTION_ID,
        instruction=get_denodo_technical_rules(),
        question=query,
    )

    formula_instruction = get_denodo_business_formula_instructions(
        query,
        table_names,
    )
    if formula_instruction:
        runtime_instructions = _append_instruction_once(
            runtime_instructions,
            instruction_id=DENODO_BUSINESS_FORMULA_INSTRUCTION_ID,
            instruction=formula_instruction,
            question=query,
        )

    temporal_instruction = get_denodo_temporal_topn_decline_instructions(
        query,
        table_names,
    )
    if temporal_instruction:
        runtime_instructions = _append_instruction_once(
            runtime_instructions,
            instruction_id=DENODO_TEMPORAL_TOPN_DECLINE_INSTRUCTION_ID,
            instruction=temporal_instruction,
            question=query,
        )

    return runtime_instructions


def _append_instruction_once(
    instructions: list[dict[str, Any]],
    *,
    instruction_id: str,
    instruction: str,
    question: str,
) -> list[dict[str, Any]]:
    if any(
        item.get("instruction_id") == instruction_id
        or item.get("instruction") == instruction
        for item in instructions
    ):
        return instructions

    return [
        *instructions,
        {
            "instruction": instruction,
            "question": question,
            "instruction_id": instruction_id,
        },
    ]


def _normalize_table_names(table_names: Iterable[str | None]) -> set[str]:
    return {
        table_name.strip().lower()
        for table_name in table_names
        if isinstance(table_name, str) and table_name.strip()
    }


def _is_smart_assignment_context(query: str, table_names: set[str]) -> bool:
    return bool(
        table_names & SMART_ASSIGNMENT_CONVERSION_TABLES
        and any(pattern.search(query) for pattern in _SMART_ASSIGNMENT_CONTEXT_PATTERNS)
    )


def _is_assignment_coverage_query(query: str) -> bool:
    return any(pattern.search(query) for pattern in _ASSIGNED_COVERAGE_PATTERNS)


def _is_assign_success_query(query: str) -> bool:
    return any(pattern.search(query) for pattern in _ASSIGN_SUCCESS_PATTERNS)
