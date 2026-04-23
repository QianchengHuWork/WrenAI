import re
from typing import Any, Iterable, Optional

from pydantic import AliasChoices, BaseModel, Field


class SemanticScope(BaseModel):
    model: str
    column: str


class ScopedCanonicalValueDictionaryEntry(BaseModel):
    scope: SemanticScope
    description: Optional[str] = None
    aliases: list[str] = Field(default_factory=list)
    canonical_value: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("canonical_value", "canonicalValue"),
    )


class ScopedCanonicalValueDictionary(BaseModel):
    version: str = "1"
    generated_at: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("generated_at", "generatedAt"),
    )
    entries: list[ScopedCanonicalValueDictionaryEntry] = Field(default_factory=list)


class CandidateModelSummary(BaseModel):
    model: str
    description: Optional[str] = None
    key_fields: list[str] = Field(default_factory=list)
    normalizable_fields: list[str] = Field(default_factory=list)
    available_canonical_mappings: list[str] = Field(default_factory=list)
    field_descriptions: list[str] = Field(default_factory=list)


class SelectedModels(BaseModel):
    primary_model: str = Field(
        validation_alias=AliasChoices("primary_model", "primaryModel")
    )
    secondary_models: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("secondary_models", "secondaryModels"),
    )
    needs_join: bool = Field(
        default=False,
        validation_alias=AliasChoices("needs_join", "needsJoin"),
    )
    reasoning: list[str] = Field(default_factory=list)


class MatchedRewrite(BaseModel):
    scope: SemanticScope
    user_phrase: str = Field(
        validation_alias=AliasChoices("user_phrase", "userPhrase")
    )
    canonical_value: str = Field(
        validation_alias=AliasChoices("canonical_value", "canonicalValue")
    )
    reason: Optional[str] = None


_LOG_WHITESPACE_PATTERN = re.compile(r"\s+")
_LOG_EMPTY_VALUE = "-"
_NORMALIZABLE_COLUMN_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"status",
        r"state",
        r"type",
        r"level",
        r"code",
        r"channel",
        r"source",
        r"flag",
        r"strategy",
        r"mode",
        r"category",
        r"^is_",
        r"^has_",
        r"状态",
        r"类型",
        r"级别",
        r"渠道",
        r"来源",
        r"是否",
        r"策略",
        r"模式",
        r"分类",
        r"编码",
    ]
]
_SIGNAL_FIELD_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"id$",
        r"date",
        r"time",
        r"amount",
        r"price",
        r"status",
        r"type",
        r"state",
        r"flag",
        r"code",
        r"level",
        r"channel",
        r"source",
        r"strategy",
        r"日期",
        r"时间",
        r"金额",
        r"价格",
        r"状态",
        r"类型",
        r"级别",
        r"策略",
        r"编码",
    ]
]
_COMMENT_MARKER_PATTERN = re.compile(r"/\*+|\*/|--\s*")
_OPAQUE_CANONICAL_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def safe_log_value(value: Any, limit: int = 240) -> str:
    if value is None:
        return _LOG_EMPTY_VALUE

    if isinstance(value, bool):
        return "true" if value else "false"

    if not isinstance(value, str):
        value = str(value)

    compact = _LOG_WHITESPACE_PATTERN.sub(" ", value).strip()
    if not compact:
        return _LOG_EMPTY_VALUE

    if len(compact) <= limit:
        return compact

    return f"{compact[:limit]}...(+{len(compact) - limit} chars)"


def normalize_log_reason(reason: str | None) -> str:
    if not isinstance(reason, str):
        return "unknown"

    normalized = re.sub(r"[^a-z0-9]+", "_", reason.lower()).strip("_")
    return normalized or "unknown"


def format_model_names(models: Iterable[str], limit: int = 6) -> str:
    normalized = []
    seen = set()
    for model in models:
        if not isinstance(model, str) or not model.strip():
            continue

        cleaned = safe_log_value(model, limit=80)
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(cleaned)

    if not normalized:
        return _LOG_EMPTY_VALUE

    suffix = ""
    if len(normalized) > limit:
        suffix = f",...(+{len(normalized) - limit} more)"

    return ",".join(normalized[:limit]) + suffix


def format_candidate_models(
    candidate_models: list[CandidateModelSummary],
    limit: int = 6,
) -> str:
    return format_model_names(
        [candidate.model for candidate in candidate_models],
        limit=limit,
    )


def format_selected_models(
    selected_models: SelectedModels | dict[str, Any] | None,
    limit: int = 4,
) -> str:
    if not selected_models:
        return _LOG_EMPTY_VALUE

    try:
        selected = (
            selected_models
            if isinstance(selected_models, SelectedModels)
            else SelectedModels.model_validate(selected_models)
        )
    except Exception:
        return safe_log_value(selected_models)

    return (
        f"primary={safe_log_value(selected.primary_model, limit=80)};"
        f"secondary={format_model_names(selected.secondary_models, limit=limit)};"
        f"needs_join={safe_log_value(selected.needs_join)}"
    )


def format_rewrite_summaries(
    rewrites: Iterable[MatchedRewrite | dict[str, Any]],
    limit: int = 5,
) -> str:
    normalized = []
    for rewrite in rewrites:
        if isinstance(rewrite, MatchedRewrite):
            payload = rewrite.model_dump()
        elif isinstance(rewrite, dict):
            payload = rewrite
        else:
            continue

        scope = payload.get("scope")
        if not isinstance(scope, dict):
            continue

        model = scope.get("model")
        column = scope.get("column")
        user_phrase = payload.get("user_phrase") or payload.get("userPhrase")
        canonical_value = payload.get("canonical_value") or payload.get(
            "canonicalValue"
        )
        reason = payload.get("reason")
        if not all(
            isinstance(item, str) and item.strip()
            for item in [model, column, user_phrase, canonical_value]
        ):
            continue

        detail = (
            f"{safe_log_value(model, limit=80)}.{safe_log_value(column, limit=80)}:"
            f"{safe_log_value(user_phrase, limit=48)}"
            f"->{safe_log_value(canonical_value, limit=48)}"
        )
        if isinstance(reason, str) and reason.strip():
            detail += f" ({safe_log_value(reason, limit=80)})"
        normalized.append(detail)

    if not normalized:
        return _LOG_EMPTY_VALUE

    suffix = ""
    if len(normalized) > limit:
        suffix = f"; ...(+{len(normalized) - limit} more)"

    return "; ".join(normalized[:limit]) + suffix


def _normalize_aliases(values: Iterable[str]) -> list[str]:
    normalized = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(cleaned)
    return normalized


def _is_safe_rewrite_alias(value: str) -> bool:
    cleaned = value.strip()
    if not cleaned:
        return False

    # Single-character aliases like "是"/"否"/"A" are too ambiguous in free text
    # and easily corrupt unrelated words such as "多少".
    if len(cleaned) == 1:
        return False

    return True


def _rewrite_safe_aliases(values: Iterable[str]) -> list[str]:
    return [
        value
        for value in _normalize_aliases(values)
        if _is_safe_rewrite_alias(value)
    ]


def normalize_semantic_dictionary(
    semantic_dictionary: ScopedCanonicalValueDictionary | dict | None,
) -> ScopedCanonicalValueDictionary | None:
    if not semantic_dictionary:
        return None

    if isinstance(semantic_dictionary, ScopedCanonicalValueDictionary):
        return semantic_dictionary

    if isinstance(semantic_dictionary, dict):
        return ScopedCanonicalValueDictionary.model_validate(semantic_dictionary)

    return None


def extract_comment_text(comment: Optional[str]) -> Optional[str]:
    if not isinstance(comment, str) or not comment.strip():
        return None

    cleaned = _COMMENT_MARKER_PATTERN.sub(" ", comment)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or None


def _is_normalizable_column(column_name: str, description: Optional[str]) -> bool:
    candidate = " ".join(filter(None, [column_name, description or ""]))
    return any(pattern.search(candidate) for pattern in _NORMALIZABLE_COLUMN_PATTERNS)


def _score_signal_field(
    column_name: str,
    description: Optional[str],
    is_primary_key: bool,
) -> int:
    score = 0
    if is_primary_key:
        score += 100
    if description:
        score += 8
    if any(pattern.search(column_name) for pattern in _SIGNAL_FIELD_PATTERNS):
        score += 10
    if description and any(
        pattern.search(description) for pattern in _SIGNAL_FIELD_PATTERNS
    ):
        score += 6
    return score


def filter_dictionary_entries(
    semantic_dictionary: ScopedCanonicalValueDictionary | None,
    models: Optional[Iterable[str]] = None,
) -> list[ScopedCanonicalValueDictionaryEntry]:
    if not semantic_dictionary:
        return []

    model_set = {
        model.strip().lower()
        for model in (models or [])
        if isinstance(model, str) and model.strip()
    }

    entries = []
    for entry in semantic_dictionary.entries:
        if not entry.canonical_value:
            continue
        if model_set and entry.scope.model.lower() not in model_set:
            continue

        aliases = _rewrite_safe_aliases(entry.aliases)
        if not aliases:
            continue

        entries.append(
            ScopedCanonicalValueDictionaryEntry(
                scope=entry.scope,
                description=entry.description,
                aliases=aliases,
                canonical_value=entry.canonical_value,
            )
        )

    return entries


def summarize_dictionary_entries(
    entries: list[ScopedCanonicalValueDictionaryEntry],
    max_entries: int = 40,
) -> str | None:
    if not entries:
        return None

    lines = []
    for entry in entries[:max_entries]:
        aliases = ", ".join(entry.aliases)
        description = f" | description: {entry.description}" if entry.description else ""
        lines.append(
            f"- scope: {entry.scope.model}.{entry.scope.column} | canonical: {entry.canonical_value} | aliases: {aliases}{description}"
        )

    return "\n".join(lines) if lines else None


def build_candidate_model_summaries(
    db_schemas: list[dict],
    semantic_dictionary: ScopedCanonicalValueDictionary | None,
) -> list[CandidateModelSummary]:
    dictionary_entries = filter_dictionary_entries(semantic_dictionary)
    entry_map: dict[str, list[ScopedCanonicalValueDictionaryEntry]] = {}
    for entry in dictionary_entries:
        entry_map.setdefault(entry.scope.model.lower(), []).append(entry)

    summaries: list[CandidateModelSummary] = []
    for schema in db_schemas:
        if schema.get("type") != "TABLE":
            continue

        model_name = schema.get("name")
        if not isinstance(model_name, str) or not model_name.strip():
            continue

        columns = [
            column
            for column in schema.get("columns", [])
            if column.get("type") == "COLUMN" and isinstance(column.get("name"), str)
        ]
        dictionary_by_column = {}
        for entry in entry_map.get(model_name.lower(), []):
            key = entry.scope.column.lower()
            dictionary_by_column.setdefault(key, []).append(entry)

        scored_fields = []
        normalizable_fields = []
        field_descriptions = []

        for column in columns:
            column_name = column["name"]
            description = extract_comment_text(column.get("comment"))
            if description:
                field_descriptions.append(f"{column_name}: {description}")

            scored_fields.append(
                (
                    _score_signal_field(
                        column_name,
                        description,
                        bool(column.get("is_primary_key")),
                    ),
                    column_name,
                )
            )

            if dictionary_by_column.get(column_name.lower()) or _is_normalizable_column(
                column_name, description
            ):
                normalizable_fields.append(column_name)

        available_canonical_mappings = []
        for column_name, scoped_entries in dictionary_by_column.items():
            for entry in scoped_entries:
                aliases = ", ".join(entry.aliases[:3])
                available_canonical_mappings.append(
                    f"{column_name}: {aliases} -> {entry.canonical_value}"
                )

        scored_fields.sort(key=lambda item: (-item[0], item[1]))
        key_fields = [column_name for _, column_name in scored_fields[:6]]

        summaries.append(
            CandidateModelSummary(
                model=model_name,
                description=extract_comment_text(schema.get("comment")),
                key_fields=key_fields,
                normalizable_fields=_normalize_aliases(normalizable_fields)[:8],
                available_canonical_mappings=_normalize_aliases(
                    available_canonical_mappings
                )[:10],
                field_descriptions=_normalize_aliases(field_descriptions)[:12],
            )
        )

    return summaries


def validate_scope_resolution_result(
    payload: Any,
    candidate_models: list[CandidateModelSummary],
) -> SelectedModels | None:
    if not isinstance(payload, dict):
        return None

    candidate_names = {item.model for item in candidate_models}
    primary_model = payload.get("primary_model")
    if not isinstance(primary_model, str) or primary_model not in candidate_names:
        return None

    secondary_models = [
        model
        for model in payload.get("secondary_models", [])
        if isinstance(model, str)
        and model in candidate_names
        and model != primary_model
    ]
    reasoning = [
        item.strip()
        for item in payload.get("reasoning", [])
        if isinstance(item, str) and item.strip()
    ]

    return SelectedModels(
        primary_model=primary_model,
        secondary_models=secondary_models[:3],
        needs_join=bool(payload.get("needs_join")) or bool(secondary_models),
        reasoning=reasoning[:6],
    )


def _build_allowed_canonical_map(
    entries: list[ScopedCanonicalValueDictionaryEntry],
) -> dict[tuple[str, str], set[str]]:
    allowed: dict[tuple[str, str], set[str]] = {}
    for entry in entries:
        if not entry.canonical_value:
            continue
        key = (entry.scope.model.lower(), entry.scope.column.lower())
        allowed.setdefault(key, set()).add(entry.canonical_value)
    return allowed


def _build_allowed_alias_map(
    entries: list[ScopedCanonicalValueDictionaryEntry],
) -> dict[tuple[str, str, str], set[str]]:
    allowed: dict[tuple[str, str, str], set[str]] = {}
    for entry in entries:
        if not entry.canonical_value:
            continue

        key = (
            entry.scope.model.lower(),
            entry.scope.column.lower(),
            entry.canonical_value,
        )
        allowed.setdefault(key, set()).update(_rewrite_safe_aliases(entry.aliases))

    return allowed


def _is_opaque_canonical_value(value: str) -> bool:
    cleaned = value.strip()
    if not cleaned:
        return False

    if len(cleaned) <= 2:
        return True

    return bool(_OPAQUE_CANONICAL_PATTERN.fullmatch(cleaned))


def _validate_supported_normalized_query(
    *,
    original_query: str,
    normalized_query: str | None,
    entries: list[ScopedCanonicalValueDictionaryEntry],
    rewrites: list[MatchedRewrite],
) -> str | None:
    if not normalized_query:
        return None

    if normalized_query == original_query:
        return normalized_query

    backed_canonical_values = {rewrite.canonical_value for rewrite in rewrites}
    for entry in entries:
        canonical_value = entry.canonical_value
        if not canonical_value or not _is_opaque_canonical_value(canonical_value):
            continue

        introduced = (
            canonical_value in normalized_query and canonical_value not in original_query
        )
        if introduced and canonical_value not in backed_canonical_values:
            return None

    return normalized_query


def build_query_from_rewrites(
    query: str,
    rewrites: list[MatchedRewrite],
) -> str:
    normalized_query = query
    for rewrite in sorted(
        rewrites,
        key=lambda item: (
            len(item.user_phrase),
            len(item.scope.model),
            len(item.scope.column),
        ),
        reverse=True,
    ):
        if (
            rewrite.user_phrase == rewrite.canonical_value
            or not _is_safe_rewrite_alias(rewrite.user_phrase)
        ):
            continue
        normalized_query = re.sub(
            re.escape(rewrite.user_phrase),
            rewrite.canonical_value,
            normalized_query,
        )
    return normalized_query


def _deterministic_rewrites(
    query: str,
    entries: list[ScopedCanonicalValueDictionaryEntry],
) -> list[MatchedRewrite]:
    rewrites: list[MatchedRewrite] = []
    seen = set()

    for entry in sorted(
        entries,
        key=lambda item: max((len(alias) for alias in item.aliases), default=0),
        reverse=True,
    ):
        if not entry.canonical_value:
            continue

        for alias in sorted(entry.aliases, key=len, reverse=True):
            if not alias or alias == entry.canonical_value or alias not in query:
                continue
            if not _is_safe_rewrite_alias(alias):
                continue

            key = (
                entry.scope.model.lower(),
                entry.scope.column.lower(),
                alias.lower(),
                entry.canonical_value,
            )
            if key in seen:
                continue
            seen.add(key)
            rewrites.append(
                MatchedRewrite(
                    scope=entry.scope,
                    user_phrase=alias,
                    canonical_value=entry.canonical_value,
                    reason="Matched scoped canonical dictionary",
                )
            )
            break

    return rewrites


def validate_query_normalization_result(
    payload: Any,
    query: str,
    entries: list[ScopedCanonicalValueDictionaryEntry],
) -> tuple[str, list[MatchedRewrite]]:
    allowed_canonicals = _build_allowed_canonical_map(entries)
    allowed_aliases = _build_allowed_alias_map(entries)
    validated_rewrites: list[MatchedRewrite] = []

    if isinstance(payload, dict):
        for item in payload.get("matched_rewrites", []):
            if not isinstance(item, dict):
                continue

            scope = item.get("scope") or {}
            model = scope.get("model")
            column = scope.get("column")
            user_phrase = item.get("user_phrase")
            canonical_value = item.get("canonical_value") or item.get(
                "canonicalValue"
            )
            reason = item.get("reason")

            if not (
                isinstance(model, str)
                and isinstance(column, str)
                and isinstance(user_phrase, str)
                and isinstance(canonical_value, str)
                and user_phrase.strip()
                and canonical_value.strip()
            ):
                continue

            if not _is_safe_rewrite_alias(user_phrase.strip()):
                continue

            if user_phrase.strip() not in query:
                continue

            if canonical_value not in allowed_canonicals.get(
                (model.lower(), column.lower()), set()
            ):
                continue

            if user_phrase.strip() not in allowed_aliases.get(
                (model.lower(), column.lower(), canonical_value.strip()),
                set(),
            ):
                continue

            validated_rewrites.append(
                MatchedRewrite(
                    scope=SemanticScope(model=model, column=column),
                    user_phrase=user_phrase.strip(),
                    canonical_value=canonical_value.strip(),
                    reason=reason.strip() if isinstance(reason, str) else None,
                )
            )

    if not validated_rewrites:
        validated_rewrites = _deterministic_rewrites(query, entries)

    normalized_query = None
    if isinstance(payload, dict) and isinstance(payload.get("normalized_query"), str):
        normalized_query = _validate_supported_normalized_query(
            original_query=query,
            normalized_query=payload.get("normalized_query").strip(),
            entries=entries,
            rewrites=validated_rewrites,
        )

    if not normalized_query:
        normalized_query = build_query_from_rewrites(query, validated_rewrites)

    if validated_rewrites and normalized_query == query:
        normalized_query = build_query_from_rewrites(query, validated_rewrites)

    return normalized_query or query, validated_rewrites
