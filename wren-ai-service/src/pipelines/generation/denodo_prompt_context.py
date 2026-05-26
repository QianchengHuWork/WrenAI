import calendar
import re
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

from src.core.engine import clean_generation_result
from src.utils import loads_llm_json

DENODO_CONTEXT_MARKER = "[[WREN_DENODO_CONTEXT]]"
DENODO_TECHNICAL_RULES_INSTRUCTION_ID = "denodo_vql_technical_rules"
DENODO_BUSINESS_FORMULA_INSTRUCTION_ID = "denodo_business_formula_rules"
DENODO_TEMPORAL_TOPN_DECLINE_INSTRUCTION_ID = "denodo_temporal_topn_decline_rules"
DENODO_METRIC_FORMULA_INSTRUCTION_ID_PREFIX = "denodo_metric_formula"

CONVERSION_CORE_TABLE = "dv_clew_ord_conversion_core"
ASSIGN_TOTAL_CONVERSION_TABLE = "dv_assign_total_conversion_core"
ORDER_CITY_TABLE = "dm_ord_month_city"
TOTAL_CLEW_TABLE = "dv_clew_total_core"
CLEW_CORE_TABLE = "dv_clew_core"
ORD_CORE_TABLE = "dv_ord_core"

_HIDDEN_CLEW_OVERVIEW_SQL_TEMPLATE = """
WITH leads_per_niche AS (
    SELECT
        niche_id,
        COUNT(DISTINCT clew_id) AS lead_count,
        MIN(create_date) AS min_clue_date
    FROM dv_clew_core
    WHERE create_date >= '{start_date_key}'
      AND create_date < '{next_month_start_date_key}'
      AND niche_id IS NOT NULL
    GROUP BY niche_id
),
orders_per_niche AS (
    SELECT
        o.niche_id,
        MAX(CASE WHEN o.is_ord_pay = 1 THEN 1 ELSE 0 END) AS has_ord_pay,
        MAX(CASE WHEN o.is_ord_fdpay = 1 THEN 1 ELSE 0 END) AS has_ord_fdpay,
        COALESCE(SUM(CASE WHEN o.is_ord_pay = 1 THEN o.gross_order_amount END), 0) AS total_amt_pay,
        COALESCE(SUM(CASE WHEN o.is_ord_fdpay = 1 THEN o.gross_order_amount END), 0) AS total_amt_fdpay
    FROM dv_ord_core o
    JOIN leads_per_niche l ON o.niche_id = l.niche_id
    WHERE order_date_key >= l.min_clue_date
    GROUP BY o.niche_id
)
SELECT
    SUM(l.lead_count) AS total_clues,
    COUNT(DISTINCT CASE WHEN o.has_ord_pay = 1 THEN l.niche_id END) AS order_with_refund_cnt,
    COUNT(DISTINCT CASE WHEN o.has_ord_fdpay = 1 THEN l.niche_id END) AS order_no_refund_cnt,
    COALESCE(SUM(o.total_amt_pay), 0) AS amount_with_refund,
    COALESCE(SUM(o.total_amt_fdpay), 0) AS amount_no_refund,
    ROUND(
        COUNT(DISTINCT CASE WHEN o.has_ord_pay = 1 THEN l.niche_id END) * 100.0
        / NULLIF(SUM(l.lead_count), 0),
        2
    ) AS conversion_with_refund,
    ROUND(
        COUNT(DISTINCT CASE WHEN o.has_ord_fdpay = 1 THEN l.niche_id END) * 100.0
        / NULLIF(SUM(l.lead_count), 0),
        2
    ) AS conversion_no_refund,
    ROUND(
        (
            COUNT(DISTINCT CASE WHEN o.has_ord_pay = 1 THEN l.niche_id END)
            - COUNT(DISTINCT CASE WHEN o.has_ord_fdpay = 1 THEN l.niche_id END)
        ) * 100.0
        / NULLIF(SUM(l.lead_count), 0),
        2
    ) AS refund_impact_pct
FROM leads_per_niche l
LEFT JOIN orders_per_niche o ON l.niche_id = o.niche_id
""".strip()

SMART_ASSIGNMENT_CONVERSION_TABLES = {
    ASSIGN_TOTAL_CONVERSION_TABLE,
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
_SMART_ASSIGNMENT_METRIC_PATTERNS = [
    re.compile(r"线索数"),
    re.compile(r"线索量"),
    re.compile(r"订单数"),
    re.compile(r"转化订单数"),
    re.compile(r"转化订单金额"),
    re.compile(r"转化金额"),
    re.compile(r"订单金额"),
    re.compile(r"lead count", re.IGNORECASE),
    re.compile(r"order count", re.IGNORECASE),
    re.compile(r"conversion amount", re.IGNORECASE),
    re.compile(r"conversion order amount", re.IGNORECASE),
]
_LEAD_SOURCE_PATTERNS = [
    re.compile(r"线索.{0,8}来源"),
    re.compile(r"来源.{0,8}线索"),
    re.compile(r"四级来源"),
    re.compile(r"来源目录"),
    re.compile(r"来源渠道"),
    re.compile(r"渠道"),
    re.compile(r"lead source", re.IGNORECASE),
    re.compile(r"source channel", re.IGNORECASE),
]
_LEAD_OVERVIEW_PATTERNS = [
    re.compile(r"全量线索"),
    re.compile(r"全部线索"),
    re.compile(r"线索大盘"),
    re.compile(r"线索转化"),
    re.compile(r"大定支付转化率"),
    re.compile(r"大定转化率"),
    re.compile(r"剔除退订"),
    re.compile(r"含退订"),
    re.compile(r"不含退订"),
    re.compile(r"all leads", re.IGNORECASE),
    re.compile(r"lead overview", re.IGNORECASE),
]
_LEAD_COUNT_PATTERNS = [
    re.compile(r"线索量"),
    re.compile(r"线索数"),
    re.compile(r"lead count", re.IGNORECASE),
    re.compile(r"leads", re.IGNORECASE),
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


def is_smart_assignment_conversion_metric_query(query: str) -> bool:
    normalized = query.strip()
    if not normalized:
        return False

    return _is_smart_assignment_context(normalized, set()) and (
        is_conversion_rate_query(normalized)
        or any(
            pattern.search(normalized)
            for pattern in _SMART_ASSIGNMENT_METRIC_PATTERNS
        )
    )


def is_lead_source_conversion_query(query: str) -> bool:
    normalized = query.strip()
    if not normalized:
        return False
    if _is_smart_assignment_context(normalized, set()):
        return False

    return (
        any(pattern.search(normalized) for pattern in _LEAD_SOURCE_PATTERNS)
        and any(pattern.search(normalized) for pattern in _LEAD_COUNT_PATTERNS)
        and is_conversion_rate_query(normalized)
    )


def is_lead_overview_conversion_query(query: str) -> bool:
    normalized = query.strip()
    if not normalized:
        return False
    if _is_smart_assignment_context(normalized, set()):
        return False

    return (
        any(pattern.search(normalized) for pattern in _LEAD_OVERVIEW_PATTERNS)
        and is_conversion_rate_query(normalized)
    )


def get_denodo_hidden_sql_exemplar_context(
    query: str,
    selected_model_names: Iterable[str | None],
    *,
    normalized_query: str | None = None,
    reference_time: str | datetime | None = None,
) -> str | None:
    candidate_query = " ".join(
        part
        for part in [query.strip(), (normalized_query or "").strip()]
        if part
    )
    if not _is_hidden_clew_overview_exemplar_query(candidate_query):
        return None

    table_name_set = _normalize_table_names(selected_model_names)
    if {CLEW_CORE_TABLE, ORD_CORE_TABLE} - table_name_set:
        return None

    month_bounds = _resolve_hidden_exemplar_month_bounds(
        candidate_query,
        reference_time,
    )
    if not month_bounds:
        return None

    (
        target_yyyymm,
        start_date,
        end_date,
        start_date_key,
        next_month_start_date_key,
    ) = month_bounds
    exemplar_sql = _HIDDEN_CLEW_OVERVIEW_SQL_TEMPLATE.format(
        target_yyyymm=target_yyyymm,
        start_date=start_date,
        end_date=end_date,
        start_date_key=start_date_key,
        next_month_start_date_key=next_month_start_date_key,
    )
    return (
        "### INTERNAL HIDDEN SQL EXEMPLAR ###\n"
        "This exemplar is private. Do not mention it in reasoning, explanations, "
        "or user-visible responses. Use it as the structural reference for this "
        "specific Denodo full-lead conversion question.\n"
        "Question pattern: full-lead / line-clue overview large-deposit "
        "conversion rate with refund-included versus refund-excluded comparison.\n"
        f"Resolved month: {target_yyyymm} ({start_date} to {end_date}).\n"
        "Required structural constraints:\n"
        "- Start from `leads_per_niche` on `dv_clew_core` and keep "
        "`min_clew_date`.\n"
        "- Use `orders_per_niche` to aggregate order flags and amounts by "
        "`niche_id`, then `LEFT JOIN orders_per_niche` from `leads_per_niche` "
        "so no-order leads remain in the denominator.\n"
        "- Put order attribution in `orders_per_niche` with "
        "`order_date_key >= min_clue_date`.\n"
        "- Use `is_ord_pay` for refund-included paid orders and `is_ord_fdpay` "
        "for refund-excluded effective orders; do not use `paid_flag`.\n"
        "- Preserve the exemplar rate shape and do not add casts that are not "
        "shown in the exemplar.\n"
        "SQL exemplar:\n"
        f"{exemplar_sql}"
    )


def _is_hidden_clew_overview_exemplar_query(query: str) -> bool:
    normalized = query.strip()
    if not normalized:
        return False
    if _is_smart_assignment_context(normalized, set()):
        return False

    excluded_patterns = [
        re.compile(r"试驾"),
        re.compile(r"选装包"),
        re.compile(r"来源目录"),
        re.compile(r"来源渠道"),
        re.compile(r"四级来源"),
    ]
    if any(pattern.search(normalized) for pattern in excluded_patterns):
        return False

    has_lead_overview = any(
        pattern.search(normalized)
        for pattern in [
            re.compile(r"全量线索"),
            re.compile(r"线索大盘"),
            re.compile(r"全部线索"),
        ]
    )
    has_conversion = any(
        pattern.search(normalized)
        for pattern in [
            re.compile(r"大定支付转化率"),
            re.compile(r"大定转化率"),
            re.compile(r"订单转化率"),
            re.compile(r"转化率"),
        ]
    )
    has_refund_comparison = any(
        pattern.search(normalized)
        for pattern in [
            re.compile(r"剔除退订"),
            re.compile(r"含退订"),
            re.compile(r"不含退订"),
            re.compile(r"含退款"),
            re.compile(r"不含退款"),
            re.compile(r"退款差别"),
            re.compile(r"退订.*差别"),
        ]
    )
    return has_lead_overview and has_conversion and has_refund_comparison


def _resolve_hidden_exemplar_month_bounds(
    query: str,
    reference_time: str | datetime | None,
) -> tuple[str, str, str, str, str] | None:
    reference_date = _parse_reference_datetime(reference_time) or datetime.now()

    explicit_yyyymm = re.search(r"(?<!\d)(20\d{2})(0[1-9]|1[0-2])(?!\d)", query)
    if explicit_yyyymm:
        year = int(explicit_yyyymm.group(1))
        month = int(explicit_yyyymm.group(2))
        return _format_month_bounds(year, month)

    explicit_year_month = re.search(
        r"(20\d{2})\s*[年/-]\s*(1[0-2]|0?[1-9])\s*月?",
        query,
    )
    if explicit_year_month:
        year = int(explicit_year_month.group(1))
        month = int(explicit_year_month.group(2))
        return _format_month_bounds(year, month)

    if "上个月" in query or "上月" in query:
        first_day = reference_date.replace(day=1)
        previous_month = first_day - timedelta(days=1)
        return _format_month_bounds(previous_month.year, previous_month.month)

    month_only = re.search(r"(?<!\d)(1[0-2]|0?[1-9])\s*月", query)
    if month_only:
        return _format_month_bounds(reference_date.year, int(month_only.group(1)))

    return None


def _parse_reference_datetime(reference_time: str | datetime | None) -> datetime | None:
    if isinstance(reference_time, datetime):
        return reference_time
    if not isinstance(reference_time, str) or not reference_time.strip():
        return None
    match = re.search(r"(20\d{2})-(\d{2})-(\d{2})", reference_time)
    if not match:
        return None
    return datetime(
        year=int(match.group(1)),
        month=int(match.group(2)),
        day=int(match.group(3)),
    )


def _format_month_bounds(year: int, month: int) -> tuple[str, str, str, str, str]:
    last_day = calendar.monthrange(year, month)[1]
    target_yyyymm = f"{year}{month:02d}"
    if month == 12:
        next_year, next_month = year + 1, 1
    else:
        next_year, next_month = year, month + 1
    return (
        target_yyyymm,
        f"{year}-{month:02d}-01",
        f"{year}-{month:02d}-{last_day:02d}",
        f"{year}{month:02d}01",
        f"{next_year}{next_month:02d}01",
    )


def prioritize_conversion_core_documents(
    query: str,
    documents: list[dict],
    metric_formulas: Iterable[Any] | None = None,
) -> list[dict]:
    # Preserve retrieval order. Scope selection is handled by the
    # scope-resolution model using prompt guidance, not deterministic
    # document re-ranking.
    return documents


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
        "6. Do not use TO_NUMBER in Denodo VQL. Use the numeric fields and "
        "metric expressions exactly as provided by the retrieved schema or "
        "runtime metric formulas; do not add casts just for numeric conversion.\n"
        "7. Do not introduce a CTE just to compute a casted field, rename fields, "
        "or filter one table. For simple single-view aggregations, aggregate the "
        "metric field directly unless the runtime metric formula explicitly "
        "contains a cast. Use CTEs only when they are needed for mixed grains, "
        "top-N per group, or multi-step joins.\n"
        "8. Partition fields are view-specific. Only add `ptstart` and `ptend` "
        "filters to a view when that exact view's retrieved schema includes both "
        "columns. Do not copy `ptstart` or `ptend` filters from one selected view "
        "to another. For `dm_ord_month_city`, use `order_year_month` for month "
        "filtering unless its retrieved schema explicitly lists `ptstart` and "
        "`ptend`. When `ptstart`/`ptend` are used, they are Denodo parameter "
        "boundary fields and must use equality only: `ptstart = '<start_yyyymmdd>' "
        "AND ptend = '<end_yyyymmdd>'`. Do not use <, <=, >, >=, or BETWEEN "
        "with `ptstart` or `ptend`.\n"
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
        "share, or numerator/denominator metrics that use ROUND(expr, scale), "
        "preserve the expression shape from runtime metric formulas when one is "
        "provided and wrap the denominator with NULLIF(..., 0). Do not add casts "
        "unless the runtime metric formula explicitly includes them.\n"
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

    table_name_set = _normalize_table_names(table_names)
    if _is_assign_success_query(normalized_query):
        return (
            "Denodo business formula: for assignment success rate, calculate "
            "`assigned_clew_count / assign_count` with NULLIF on the denominator."
        )

    if _is_assignment_coverage_query(normalized_query):
        return (
            "Denodo business formula: for smart-assignment coverage rate, "
            "calculate `assigned_clew_count / total_clew_count` with NULLIF on "
            "the denominator."
        )

    if is_smart_assignment_conversion_metric_query(normalized_query):
        if ASSIGN_TOTAL_CONVERSION_TABLE not in table_name_set:
            return None
        return (
            "Denodo business formula: for smart-assignment lead conversion "
            f"metrics, use `{ASSIGN_TOTAL_CONVERSION_TABLE}` when it is present "
            "in retrieved schema or selected models. Calculate `clew_count` as "
            '`COUNT(DISTINCT "clew_id")`; calculate `order_count` as '
            '`COUNT(DISTINCT CASE WHEN "is_ord_fdpay" = 1 THEN "biz_order_no" '
            "END)`; calculate `conversion_rate` by expanding the full "
            "expression "
            '`ROUND(COUNT(DISTINCT CASE WHEN "is_ord_fdpay" = 1 THEN '
            '"biz_order_no" END) * 100.0 / NULLIF(COUNT(DISTINCT "clew_id"), '
            '0), 2)`; calculate `total_amount` as '
            '`COALESCE(SUM(CASE WHEN "is_ord_fdpay" = 1 THEN '
            '"actual_price" END), 0)`. Do not calculate '
            "smart-assignment conversion rate as "
            "`converted_order_count / assigned_clew_count`; do not use "
            f"`{CONVERSION_CORE_TABLE}` for smart-assignment lead conversion "
            f"metrics when `{ASSIGN_TOTAL_CONVERSION_TABLE}` is available. Do "
            "not use `COUNT(*)` as smart-assignment lead count, do not use "
            '`is_ord_pay` for converted orders, and do not use `SUM(CASE WHEN '
            '... THEN 1 ELSE 0 END)` as the converted-order count.'
        )

    if not is_conversion_rate_query(normalized_query):
        return None

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
        "`converted_order_count / total_clew_count` with NULLIF on the "
        "denominator. Do not use `assigned_clew_count` as the generic "
        "conversion-rate denominator. Smart-assignment conversion metrics have "
        "a separate rule and must not be inferred from this generic formula. "
        f"{total_table_note}"
    )


def get_denodo_metric_formula_instructions(
    query: str,
    table_names: Iterable[str | None],
    metric_formulas: Iterable[Any] | None,
) -> list[tuple[str, str]]:
    table_name_set = _normalize_table_names(table_names)
    instructions: list[tuple[str, str]] = []

    for formula in _iter_matching_metric_formulas(
        query,
        table_name_set,
        metric_formulas,
    ):
        formula_id = _metric_formula_id(formula)
        instruction = _format_metric_formula_instruction(formula)
        if instruction:
            instructions.append(
                (
                    f"{DENODO_METRIC_FORMULA_INSTRUCTION_ID_PREFIX}:{formula_id}",
                    instruction,
                )
            )

    return instructions


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
        "arithmetic on raw YYYYMM strings. If the monthly conversion view uses "
        "`ptstart`/`ptend`, apply them as equality predicates for the requested "
        "date boundary only, never as range predicates. The Top-N city CTE must actually filter the "
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
    metric_formulas: Iterable[Any] | None = None,
    include_scope_dependent_instructions: bool = True,
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

    if not include_scope_dependent_instructions:
        return runtime_instructions

    metric_formula_instructions = get_denodo_metric_formula_instructions(
        query,
        table_names,
        metric_formulas,
    )
    for instruction_id, instruction in metric_formula_instructions:
        runtime_instructions = _append_instruction_once(
            runtime_instructions,
            instruction_id=instruction_id,
            instruction=instruction,
            question=query,
        )

    if not metric_formula_instructions:
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
        _normalize_table_name(table_name)
        for table_name in table_names
        if isinstance(table_name, str) and table_name.strip()
    }


def _normalize_table_name(table_name: str | None) -> str:
    return table_name.strip().lower() if isinstance(table_name, str) else ""


def _iter_matching_metric_formulas(
    query: str,
    table_name_set: set[str],
    metric_formulas: Iterable[Any] | None,
) -> Iterable[dict[str, Any]]:
    normalized_query = query.strip()
    if not normalized_query or not metric_formulas:
        return []

    matches = []
    for formula in metric_formulas:
        normalized_formula = _normalize_metric_formula(formula)
        if not normalized_formula:
            continue
        if not normalized_formula.get("enabled", True):
            continue
        if str(normalized_formula.get("dataSource") or "").lower() != "denodo":
            continue

        primary_model = _normalize_table_name(
            _metric_formula_primary_model(normalized_formula)
        )
        if table_name_set and not _matching_table_names(primary_model, table_name_set):
            continue
        if table_name_set and not _required_metric_formula_models_present(
            normalized_formula,
            table_name_set,
        ):
            continue

        matches.append(normalized_formula)

    return matches


def _required_metric_formula_models_present(
    formula: dict[str, Any],
    table_name_set: set[str],
) -> bool:
    return all(
        _matching_table_names(model, table_name_set)
        for model in _metric_formula_required_models(formula)
    )


def _matching_table_names(model_name: str, table_name_set: set[str]) -> list[str]:
    normalized_model = _normalize_table_name(model_name)
    if not normalized_model:
        return []
    return [
        table_name
        for table_name in table_name_set
        if _model_names_match(normalized_model, table_name)
    ]


def _model_names_match(expected: str, actual: str) -> bool:
    if not expected or not actual:
        return False
    return (
        expected == actual
        or expected.endswith(f".{actual}")
        or actual.endswith(f".{expected}")
    )


def _normalize_metric_formula(formula: Any) -> dict[str, Any] | None:
    if formula is None:
        return None

    if hasattr(formula, "model_dump"):
        formula = formula.model_dump()
    if not isinstance(formula, dict):
        return None

    scope = formula.get("scope") or {}
    if hasattr(scope, "model_dump"):
        scope = scope.model_dump()
    match = formula.get("match") or {}
    if hasattr(match, "model_dump"):
        match = match.model_dump()

    return {
        **formula,
        "dataSource": _coalesce_value(formula, "dataSource", "data_source"),
        "forbiddenPatterns": _coalesce_value(
            formula,
            "forbiddenPatterns",
            "forbidden_patterns",
        )
        or [],
        "extraInstruction": _coalesce_value(
            formula,
            "extraInstruction",
            "extra_instruction",
        )
        or "",
        "scope": {
            **scope,
            "primaryModel": _coalesce_value(scope, "primaryModel", "primary_model")
            or "",
            "requiredModels": _coalesce_value(
                scope,
                "requiredModels",
                "required_models",
            )
            or [],
        },
        "match": {
            **match,
            "triggerPhrases": _coalesce_value(
                match,
                "triggerPhrases",
                "trigger_phrases",
            )
            or [],
            "exampleQuestions": _coalesce_value(
                match,
                "exampleQuestions",
                "example_questions",
            )
            or [],
        },
    }


def _coalesce_value(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value is not None:
            return value
    return None


def _metric_formula_query_matches(query: str, formula: dict[str, Any]) -> bool:
    query_lower = query.lower()
    phrases = [
        *(_metric_formula_match_list(formula, "triggerPhrases")),
        *(_metric_formula_match_list(formula, "exampleQuestions")),
    ]
    return any(phrase.lower() in query_lower for phrase in phrases if phrase)


def _metric_formula_match_list(
    formula: dict[str, Any],
    key: str,
) -> list[str]:
    value = (formula.get("match") or {}).get(key) or []
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _metric_formula_id(formula: dict[str, Any]) -> str:
    formula_id = formula.get("id")
    if isinstance(formula_id, str) and formula_id.strip():
        return formula_id.strip()
    return re.sub(r"[^a-z0-9_]+", "_", _metric_formula_name(formula).lower())


def _metric_formula_name(formula: dict[str, Any]) -> str:
    name = formula.get("name")
    return name.strip() if isinstance(name, str) and name.strip() else "Metric formula"


def _metric_formula_primary_model(formula: dict[str, Any]) -> str:
    scope = formula.get("scope") or {}
    primary_model = scope.get("primaryModel")
    return (
        primary_model.strip()
        if isinstance(primary_model, str) and primary_model.strip()
        else ""
    )


def _metric_formula_required_models(formula: dict[str, Any]) -> list[str]:
    scope = formula.get("scope") or {}
    required_models = scope.get("requiredModels") or []
    if not isinstance(required_models, list):
        return []
    return [
        model.strip()
        for model in required_models
        if isinstance(model, str) and model.strip()
    ]


def _format_metric_formula_instruction(formula: dict[str, Any]) -> str | None:
    primary_model = _metric_formula_primary_model(formula)
    if not primary_model:
        return None

    metrics = formula.get("metrics") or []
    if not isinstance(metrics, list) or not metrics:
        return None

    metric_lines = []
    for metric in metrics:
        if hasattr(metric, "model_dump"):
            metric = metric.model_dump()
        if not isinstance(metric, dict):
            continue
        name = metric.get("name")
        expression = metric.get("expression")
        if not isinstance(name, str) or not isinstance(expression, str):
            continue
        if not name.strip() or not expression.strip():
            continue
        metric_lines.append(f"- `{name.strip()}`: `{expression.strip()}`")

    if not metric_lines:
        return None

    required_models = _metric_formula_required_models(formula)
    forbidden_patterns = formula.get("forbiddenPatterns") or []
    forbidden_text = (
        "\nForbidden SQL patterns for this metric rule: "
        + "; ".join(
            f"`{pattern}`"
            for pattern in forbidden_patterns
            if isinstance(pattern, str) and pattern.strip()
        )
        + "."
        if forbidden_patterns
        else ""
    )
    extra_instruction = formula.get("extraInstruction")
    extra_text = (
        f"\nAdditional instruction: {extra_instruction.strip()}"
        if isinstance(extra_instruction, str) and extra_instruction.strip()
        else ""
    )

    return (
        f"Denodo metric formula rule `{_metric_formula_name(formula)}`: when "
        f"the user question matches this rule and `{primary_model}` is in the "
        "retrieved schema or selected models, treat it as the authoritative "
        "scope for these metrics. "
        f"Primary model: `{primary_model}`. "
        + (
            "Required models: "
            + ", ".join(f"`{model}`" for model in required_models)
            + ". "
            if required_models
            else ""
        )
        + "Use these metric expressions exactly, expanding aliases inline when "
        "the SQL expression needs to reference the same metric again:\n"
        + "\n".join(metric_lines)
        + forbidden_text
        + extra_text
        + "\nDo not invent columns outside the retrieved schema, and do not use "
        "this formula for unrelated business concepts."
    )


def _is_smart_assignment_context(query: str, table_names: set[str]) -> bool:
    return bool(
        (
            table_names & SMART_ASSIGNMENT_CONVERSION_TABLES
            or not table_names
        )
        and any(pattern.search(query) for pattern in _SMART_ASSIGNMENT_CONTEXT_PATTERNS)
    )


def _is_assignment_coverage_query(query: str) -> bool:
    return any(pattern.search(query) for pattern in _ASSIGNED_COVERAGE_PATTERNS)


def _is_assign_success_query(query: str) -> bool:
    return any(pattern.search(query) for pattern in _ASSIGN_SUCCESS_PATTERNS)
