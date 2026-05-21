# AI Memory Changelog

Record meaningful changes to shared AI memory and major agent-relevant repository state.

## 2026-05-15 10:28 CST

- Added persistent `/ai` memory structure:
  - `AGENTS.md`
  - `AI_CONTEXT.md`
  - `ACTIVE_STATE.md`
  - `DECISIONS.md`
  - `TASKS.md`
  - `CHANGELOG.md`
- Captured initial repository architecture, startup expectations, Denodo semantic-layer direction, RAG/text-to-SQL notes, MCP ideas, and semantic routing experiment areas.
- Captured current branch: `codex/denodo-selected-views-followup`.
- Captured pre-existing dirty worktree files without modifying them.

## 2026-05-15 10:30 CST

- Added discoverability pointers in root `AGENTS.md` and `.claude/CLAUDE.md`.
- Updated active state and task tracking to mark memory initialization complete.

## 2026-05-15 10:42 CST

- Added agent progress snapshot to `ACTIVE_STATE.md`.
- Recorded current verified agent states:
  - Codex: `/ai` memory layer initialized.
  - Unknown prior session: Denodo ask SQL trace/guard work in progress.
  - Claude/Gemini/Cursor/ChatGPT/Copilot: no separate local progress record yet.
- Updated `TASKS.md` with validation follow-ups for Denodo SQL trace and guard work.

## 2026-05-15 10:55 CST

- Corrected `ACTIVE_STATE.md` agent model:
  - Previous table tracked assistant tool brands.
  - New table tracks Codex task agents/threads from the sidebar.
- Added current Codex task-agent rows:
  - `Add AI memory system`
  - `6. 测试`
  - `2. 拉起项目 专用`
  - `3. 项目总结和文案`
  - `5. AI SDK 生成 VQL`
  - `4. 分支管理`
  - `分析提问失败原因`
- Added task to backfill concrete handoff notes after opening each Codex task agent.

## 2026-05-15 11:02 CST

- Backfilled the current chat session into `/ai` memory without changing business code.
- Reconciled the current workspace state:
  - branch `codex/denodo-selected-views-followup`
  - dirty worktree includes Denodo trace/benchmark work plus the new `scripts/` helpers
- Captured the benchmark entrypoints:
  - `scripts/denodo-vql-benchmark.mjs` for `asking_task` / `generate_sql` runs
  - `scripts/ask-timing-readable-jsonl.mjs` for timing JSONL post-processing
- Recorded source-dev runtime facts verified in this session:
  - `wren-ui` runs locally on `:3000`
  - `wren-ai-service` runs locally on `:5556`
- Noted the AI service startup parsing assumption for remote docs: `llms.md` entries must be parsed with a first-newline split so multiline content does not crash startup.

## 2026-05-15 11:02 CST

- Backfilled current `3. 项目总结和文案` session state:
  - resume wording for the ChatBI PoC lives in ignored `.tmp/resume-chatbi-poc.md`
  - interview review outline lives in ignored `.tmp/chatbi-poc-review-outline.md`
- Updated `ACTIVE_STATE.md` with session scope, completed work, related files, verification status, and next handoff.
- Updated `TASKS.md` with a done item and optional follow-up to expand interview answer scripts.
- Updated `AI_CONTEXT.md` with durable ChatBI/Denodo facts confirmed in this session:
  - Hamilton pipeline vs AskService orchestration boundary
  - Denodo SQL quality split into SQL rule layer and business metric scope layer
  - semantic modeling and runtime consumption chain for Denodo ChatBI
- No business code was changed or tested during this memory backfill.

## 2026-05-15 11:04 CST

- Backfilled the current long Denodo benchmark/customer handoff chat session into shared memory.
- Updated `AI_CONTEXT.md` with durable Denodo ask timing, SQL trace, and customer POC deployment facts.
- Updated `DECISIONS.md` with durable decisions:
  - keep ask timing and SQL trace as separate artifacts
  - use GraphQL asking-task polling for trace-aligned Denodo benchmarks
  - avoid automatic config overwrite in customer POC deployment
- Updated `ACTIVE_STATE.md` with current session handoff:
  - 20-question benchmark results: 16/20 succeeded, about 82 minutes wall-clock, successful median about 161s
  - failed q12/q17/q19 due missing `dv_clew_ord_conversion_core_new`
  - failed q20 due `fetch failed` with no matching `ask_finished`
  - verified commands and unverified follow-ups
- Updated `TASKS.md` with next handoff tasks, blocked items, and completed benchmark/trace handoff records.

## 2026-05-15 11:04 CST

- Backfilled current chat branch-management history into `ACTIVE_STATE.md` and `TASKS.md`.
- Recorded customer stable branch events:
  - `codex/customer-stable-20260507` was created/pushed at `f4519dec`.
  - `origin/main` was fast-forwarded to `f4519dec` from the `20260507` stable branch.
  - `codex/customer-stable-20260513` was created/pushed at `b1c966c4`.
  - old `codex/customer-stable-20260507` remote/local branches were deleted.
- Noted verification limits: branch/ref checks only; no CI or application tests were run for these git operations.
- Did not update `AI_CONTEXT.md` or `DECISIONS.md`; this chat produced no durable architecture decision.

## 2026-05-15 11:05 CST

- Backfilled current Denodo AI SDK / VQL / skills / timing session state into `/ai` memory.
- Updated `ACTIVE_STATE.md` with:
  - `5. AI SDK 生成 VQL` handoff
  - `分析提问失败原因` handoff
  - current direct-VQL plan and benchmark/model observations
- Updated `AI_CONTEXT.md` with durable Denodo VQL-generation facts:
  - current SQL-first then UI conversion/guard architecture
  - direct-VQL mode boundaries
  - Denodo AI SDK and skills package assessment
- Updated `DECISIONS.md` with the decision not to wrap the full Denodo AI SDK as the VQL generator.
- Updated `TASKS.md` with remaining handoff tasks and direct-VQL implementation follow-up.
- No business code was changed for this memory backfill.

## 2026-05-15 14:27 CST

- Implemented Denodo complex-query decomposition with parallel validated subquery drafts in AI service.
- Added code-level settings defaulting on:
  - `enable_denodo_query_decomposition`
  - `enable_denodo_parallel_subquery_generation`
  - `denodo_query_decomposition_max_subqueries`
- Added AI service pipelines for structured decomposition and Denodo subquery draft generation.
- Wired AskService to run decomposition after schema/scope normalization and before final SQL generation, then inject validated subquery drafts into final SQL generation and correction.
- Preserved the user-facing one-final-SQL contract; subquery SQL/results remain hidden and any subquery-stage failure falls back to legacy single-SQL generation.
- Verified with AI service py_compile, focused decomposition tests, Denodo prompt context tests, and import checks for `AskService`, `generation`, and `ServiceContainer`.
- Not verified with live Denodo benchmark/runtime after this change.

## 2026-05-15 15:00 CST

- Implemented direct Denodo VQL generation in the current dirty worktree.
- Updated durable memory to reflect the new Denodo boundary:
  - AI service Denodo generation/follow-up/subquery/correction now uses VQL prompts and skips AI-service Wren-engine dry-run validation.
  - AI service AskResult can return `sql_dialect: DIALECT`.
  - UI Denodo prompt context includes native view/column mapping.
  - UI Denodo guard skips `toDenodoNativeSql` for `DIALECT` candidates while preserving semantic rewrite, DENSE_RANK rewrite, MCP validate/correction, and legacy conversion fallback.
- Recorded verification:
  - AI service `py_compile`
  - focused AI pytest for Denodo prompt/decomposition/timing/sql-correction
  - focused UI Jest for Denodo guard, Denodo MCP context, and Wren AI adaptor
  - UI typecheck
  - `git diff --check`
- Not verified with live Denodo benchmark/runtime after this change.

## 2026-05-15 16:35 CST

- Moved Denodo complex-query decomposition earlier in the ask pipeline:
  - after Denodo scope resolution / query normalization
  - before `sql_generation_reasoning`
  - before final SQL generation and correction
- Added hidden decomposition context to normal and follow-up SQL reasoning prompts.
- Kept validated internal subquery drafts hidden and available to final generation/correction.
- Added AI service `query_decomposition` response summary with no SQL content.
- Added UI GraphQL/adaptor/client plumbing for `queryDecomposition`.
- Updated `Organizing` to show selected scope, normalized query, then a lightweight "问题拆解" block with subtask count and summaries.
- Verified:
  - `python -m py_compile wren-ai-service/src/web/v1/services/ask.py wren-ai-service/src/pipelines/generation/denodo_query_decomposition.py wren-ai-service/src/pipelines/generation/sql_generation_reasoning.py wren-ai-service/src/pipelines/generation/followup_sql_generation_reasoning.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_query_decomposition.py`
  - `poetry run pytest tests/pytest/services/test_timing_events.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `cd wren-ui && yarn check-types`
  - `cd wren-ui && yarn test src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts --runInBand`
- `yarn generate-gql` was attempted but local `http://localhost:3000/api/graphql` returned 404, so affected generated GraphQL files were updated manually.
- Not verified with live Denodo benchmark/runtime after this change.

## 2026-05-16 17:04 CST

- Fixed a direct Denodo VQL failure for package-price uplift queries where Denodo rejected `AVG(TO_NUMBER(package_price)) AS avg_price_increase`.
- Strengthened Denodo prompt rules to forbid `TO_NUMBER` and prefer `CAST(<expression> AS DECIMAL(18, 2))` for numeric text conversion.
- Added UI-side expression-only sanitization for direct `DIALECT` SQL before Denodo MCP validation:
  - native Denodo table/column identifiers are not remapped
  - `TO_NUMBER(x)` is rewritten to `CAST(x AS DECIMAL(18, 2))`
  - existing expression cleanup for Denodo date functions, cast targets, and parser-emitted null limits is applied to direct VQL candidates
- Added focused AI/UI tests for prompt guidance, sanitizer behavior, and Denodo guard validation input.
- Verified:
  - `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `cd wren-ui && yarn test src/apollo/server/utils/tests/denodoMcp.test.ts src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`
  - `cd wren-ui && yarn check-types`
  - `git diff --check`
- Not verified with live Denodo execution after this fix.

## 2026-05-16 17:29 CST

- Hardened the Denodo path for the CTE-style package aggregation failure reported after the `TO_NUMBER` fix.
- Updated Denodo prompt rules:
  - avoid CTEs when they only compute a casted field, rename fields, or filter one table
  - inline `CAST(... AS DECIMAL(18, 2))` inside aggregates for simple single-view aggregations
  - reserve CTEs for mixed grains, top-N per group, or multi-step joins
- Updated UI Denodo guard:
  - MCP validate exceptions are converted into invalid validation attempts
  - existing SQL correction is invoked instead of failing the ask immediately
  - timing metadata records whether validate threw
- Added focused test coverage for the reported `Cannot read properties of null (reading 'id')` path.
- Verified:
  - `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `cd wren-ui && ./node_modules/.bin/jest src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`
  - `cd wren-ui && ./node_modules/.bin/tsc --noEmit`
  - `git diff --check`
- Not verified with live Denodo execution after this fix.

## 2026-05-16 17:51 CST

- Found the deeper root cause behind repeated `Cannot read properties of null (reading 'id')` errors on executable Denodo SQL:
  - AI service scope normalization replaced the full Denodo semantic context with only a scoped dictionary summary.
  - This dropped `[[WREN_DENODO_CONTEXT]]` and native VQL schema context.
  - SQL generation/correction post-processing then used generic Wren-engine dry-run, producing `ai_initial_dry_run_failed` even for valid Denodo VQL.
- Added `_build_scoped_denodo_semantic_context` in `AskService`:
  - preserves the Denodo marker and native VQL context
  - replaces only the `Semantic dictionary entries:` section with the scoped dictionary subset
  - falls back to existing behavior for non-Denodo contexts
- Added test coverage to ensure scoped Denodo context preserves marker/native context while removing unselected dictionary entries.
- Verified:
  - `poetry run python -m py_compile src/web/v1/services/ask.py src/pipelines/generation/sql_generation.py src/pipelines/generation/sql_correction.py`
  - `poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/pipelines/generation/test_denodo_query_decomposition.py`
  - `cd wren-ui && ./node_modules/.bin/jest src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`
  - `git diff --check`
- Not verified with live Denodo execution after this fix.

## 2026-05-18 14:52 CST

- Implemented the Denodo Q20 consecutive-decline structure fix for questions like "recent 12 months, Top 5 cities by order amount, which cities had two consecutive monthly conversion-rate declines".
- Updated AI service Denodo rules:
  - final-display Top-N may still rely on caller-side limit, but intermediate Top-N populations used by joins/filters must be truly filtered
  - no `LAG`/`LEAD` for month-over-month or consecutive-period comparisons
  - derive YYYYMM `month_index` with `CAST(SUBSTR(...))` and use self joins for adjacent months
  - continuous two-month decline means three monthly rows and two decreases
  - selected models / retrieved schema are a hard table boundary
- Added Q20-like runtime instruction that ties:
  - `dm_ord_month_city` to recent-period city order amount Top-N
  - `dv_clew_ord_conversion_core` to monthly city conversion rate
  - final assembly to Top-N filtering before three-month self-join decline detection
- Added deterministic scope override for Q20-like questions when both candidate models exist:
  - `primaryModel`: `dv_clew_ord_conversion_core`
  - `secondaryModels`: `["dm_ord_month_city"]`
  - `needsJoin`: `true`
- Updated prompts for scope resolution, decomposition, subquery generation, SQL reasoning, final SQL generation, follow-up SQL generation, and SQL correction to preserve the same Q20 structure.
- Correction prompt now explicitly handles `Function lag is not executable` by rewriting to `month_index` self joins rather than trying another window-function variant.
- Added focused tests for:
  - Denodo technical rules
  - Q20 runtime instruction
  - Q20 scope override
  - decomposition prompt guidance
- Verified:
  - `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py src/pipelines/generation/scope_resolution.py src/pipelines/generation/denodo_query_decomposition.py src/pipelines/generation/denodo_subquery_generation.py src/pipelines/generation/sql_generation.py src/pipelines/generation/sql_correction.py src/pipelines/generation/sql_generation_reasoning.py src/pipelines/generation/followup_sql_generation.py src/pipelines/generation/followup_sql_generation_reasoning.py src/web/v1/services/ask.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/pipelines/generation/test_denodo_query_decomposition.py tests/pytest/services/test_ask_runtime_instructions.py`
  - `poetry run pytest tests/pytest/services/test_timing_events.py`
  - `git diff --check`
- Not verified with live Denodo / GraphQL Q20 run after this fix.

## 2026-05-19 11:33 CST

- Investigated Q20 correction timeout `37f4fb9e-5879-48fc-82fd-a8c85d897ca6`.
- Trace showed the first Q20 fix worked on the original failure dimensions:
  - selectedModels are now `dv_clew_ord_conversion_core` + `dm_ord_month_city`
  - SQL no longer uses `LAG`
  - SQL uses three-month self joins and true correlated-count Top 5 filtering
- New failure was schema-specific:
  - Denodo validate failed with `Field not found 'dm_ord_month_city.ptstart' in view 'dm_ord_month_city'`
  - generated SQL copied `ptstart`/`ptend` predicates onto `dm_ord_month_city`, whose schema only supports `order_year_month` for month filtering
  - UI then waited 60 seconds for SQL correction and timed out
- Updated AI service Denodo rules/prompts:
  - `ptstart`/`ptend` are view-specific, not global
  - add them only when the exact view schema includes both columns
  - for `dm_ord_month_city`, use `order_year_month` unless that view explicitly lists partition fields
  - correction prompt handles `ptstart`/`ptend` field-not-found by removing invalid partition predicates
- Added UI Denodo guard deterministic cleanup:
  - new `removeUnavailableDenodoPartitionFilters` uses the manifest to remove unavailable `ptstart`/`ptend` predicates from direct VQL before MCP validation
  - guard records `denodo.unavailable_partition_filter_rewrite` timing and tool-call rewrite messages
  - this prevents the fixed `dm_ord_month_city.ptstart` error from entering 60-second correction wait
- Verified:
  - `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py src/pipelines/generation/denodo_subquery_generation.py src/pipelines/generation/sql_generation.py src/pipelines/generation/followup_sql_generation.py src/pipelines/generation/sql_generation_reasoning.py src/pipelines/generation/followup_sql_generation_reasoning.py src/pipelines/generation/sql_correction.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `cd wren-ui && yarn test src/apollo/server/utils/tests/denodoMcp.test.ts src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`
  - `cd wren-ui && yarn check-types`
  - `git diff --check`
- Not verified with live Denodo / GraphQL Q20 run after this fix.

## 2026-05-19 12:40 CST

- Investigated Q20 correction timeout `b4bcf135-1117-4b43-b239-2e832ac44f1b`.
- Trace showed this was a new failure after the partition-field fix:
  - selectedModels were correct: `dv_clew_ord_conversion_core` + `dm_ord_month_city`
  - generated SQL no longer used `LAG`
  - generated SQL used three-month self joins and a true correlated-count Top 5 filter
  - partition-field cleanup ran with `rewriteCount: 0`, so this was not the prior `dm_ord_month_city.ptstart` problem
- New Denodo validate error:
  - `Invalid parameter types of function 'subtract((SELECT max(order_year_month) AS max FROM dm_ord_month_city), '12')'`
  - generated SQL used `WHERE order_year_month >= (SELECT MAX(order_year_month) FROM dm_ord_month_city) - 12`
  - root cause: raw arithmetic on a `YYYYMM` string/month field
- Updated AI service Denodo prompts/rules:
  - forbid adding/subtracting integers directly from `YYYYMM` fields or `MAX(YYYYMM)` subqueries
  - require concrete `YYYYMM` lower/upper bounds for fixed relative windows such as recent 12 months
  - allow dynamic month arithmetic only after deriving integer `month_index`
  - correction prompt now handles invalid `subtract` errors around `MAX(...year_month...)`
- Updated tests to lock the new prompt guidance.
- Verified:
  - `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py src/pipelines/generation/sql_generation.py src/pipelines/generation/followup_sql_generation.py src/pipelines/generation/sql_generation_reasoning.py src/pipelines/generation/followup_sql_generation_reasoning.py src/pipelines/generation/denodo_subquery_generation.py src/pipelines/generation/denodo_query_decomposition.py src/pipelines/generation/sql_correction.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_query_decomposition.py`
  - `git diff --check`
- Not verified with live Denodo / GraphQL Q20 rerun after this fix.

## 2026-05-20 17:09 CST

- Added dedicated Codex task agent `7. 外部调研`.
- Updated `ACTIVE_STATE.md` with the new task-agent row and expected handoff shape.
- Updated `AGENTS.md` with an external research workflow:
  - source refs, commit/tag/date, and research question required
  - scratch material under `.tmp/external-research/`
  - durable docs under `docs/research/` when useful
  - no copying external code without license/attribution checks
- Updated `DECISIONS.md` to record external research as a durable task-agent role.
- Updated `TASKS.md` with the first backfill task for `7. 外部调研`.
- Verification: memory-only update; no business code or tests changed.

## 2026-05-20 17:22 CST

- Opened `7. 外部调研` and followed startup protocol:
  - read `/AGENTS.md`, `/ai/AGENTS.md`, `/ai/AI_CONTEXT.md`, `/ai/ACTIVE_STATE.md`, `/ai/TASKS.md`, `/ai/DECISIONS.md`, and `/ai/CHANGELOG.md`
  - checked current branch and dirty worktree state
- Recorded blocker: the assignment prompt still contains placeholders for external URL/path, research question, and expected output.
- No `docs/research/` document was created because there is no concrete source-backed research target yet.
- Updated `ACTIVE_STATE.md` and `TASKS.md`; no business code changed.

## 2026-05-20 17:32 CST

- Completed external research for `dbt-labs/metricflow` semantic-layer construction.
- Cloned source under `.tmp/external-research/metricflow` and pinned research to commit `4a36655ee67495b2b3fd71133b1d2119f58d5d22`.
- Created durable handoff doc: `docs/research/20260520-metricflow-semantic-layer.md`.
- Captured core architecture finding:
  - MetricFlow builds a typed `SemanticManifest`.
  - It normalizes/transforms and validates semantic definitions.
  - It builds semantic-model, entity, metric, and semantic-graph lookups.
  - Queries resolve to a query spec, then a dataflow plan, then engine-specific SQL.
- Updated `AI_CONTEXT.md`, `ACTIVE_STATE.md`, and `TASKS.md` with the handoff and WrenAI implications.
- Verification: source and official dbt docs inspected; no MetricFlow runtime tests executed.

## 2026-05-20 17:45 CST

- Rewrote `docs/research/20260520-metricflow-semantic-layer.md` in Chinese per user request.
- Preserved source refs, commit pin, access date, implementation implications, risks, and `not verified / 未验证` markers.
- No business code changed.
