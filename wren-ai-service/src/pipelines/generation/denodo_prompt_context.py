import re
from collections.abc import Iterable
from typing import Any

DENODO_CONTEXT_MARKER = "[[WREN_DENODO_CONTEXT]]"
DENODO_TECHNICAL_RULES_INSTRUCTION_ID = "denodo_vql_technical_rules"
DENODO_BUSINESS_FORMULA_INSTRUCTION_ID = "denodo_business_formula_rules"

CONVERSION_CORE_TABLE = "dv_clew_ord_conversion_core"
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


def prioritize_conversion_core_documents(
    query: str, documents: list[dict]
) -> list[dict]:
    if not is_conversion_rate_query(query):
        return documents

    return sorted(
        documents,
        key=lambda document: (
            0 if document.get("table_name") == CONVERSION_CORE_TABLE else 1
        ),
    )


def get_denodo_technical_rules() -> str:
    return (
        "For Denodo VQL generation and correction:\n"
        "1. Output Denodo-compatible VQL only. Always wrap table names, column "
        "names, and alias-qualified columns in double quotes.\n"
        "2. Do not generate LIMIT, FETCH, TOP, OFFSET, or NULLS FIRST/LAST. For "
        "simple top/bottom questions, use final ORDER BY only and rely on the "
        "caller-side result limit.\n"
        "3. Do not use LIMIT or FETCH inside subqueries or CTEs.\n"
        "4. Prefer semantic date fields such as *_year, *_month, and *_date over "
        "casting raw date strings. Avoid DATE_TRUNC, TO_CHAR, INTERVAL, "
        "SUBSTRING, and LENGTH unless the retrieved schema or an existing sample "
        "proves the function is supported.\n"
        "5. Do not put aggregate expressions in WHERE. Use HAVING after "
        "aggregation, and when ordering by an aggregate use the selected alias "
        "where possible.\n"
        "6. For rate, ratio, percentage, success-rate, coverage-rate, refund-rate, "
        "share, or numerator/denominator metrics, cast both numerator and "
        "denominator to FLOAT and wrap the denominator with NULLIF(..., 0). Do "
        "not use bare CAST(... AS DECIMAL) for these expressions.\n"
        "7. Do not default to DENSE_RANK or other window ranking functions for "
        "top/bottom questions. Only add ranking when the user explicitly asks "
        "for a rank column or same-rank tie semantics.\n"
        "8. Choose business numerators and denominators from explicit semantic "
        "model definitions, metric definitions, or Denodo business formula "
        "instructions. Do not infer a denominator from a similarly named count "
        "field when the business meaning is ambiguous.\n"
        "9. Only use views and columns present in the retrieved schema context."
    )


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
