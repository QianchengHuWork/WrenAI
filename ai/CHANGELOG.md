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

## 2026-05-21 15:56 CST

- Confirmed a Denodo partition semantic mismatch:
  - current prompts allowed `ptstart` / `ptend` to be written as range predicates
  - user confirmed these fields are Denodo parameter boundaries and must be equality-only
- Updated AI service prompt rules:
  - `denodo_prompt_context.py`
  - `sql_generation.py`
  - `followup_sql_generation.py`
  - `sql_generation_reasoning.py`
  - `followup_sql_generation_reasoning.py`
  - `denodo_subquery_generation.py`
  - `sql_correction.py`
  - `utils/sql.py`
- Required pattern is now:
  - `ptstart = '<start_yyyymmdd>'`
  - `ptend = '<end_yyyymmdd>'`
  - no `<`, `<=`, `>`, `>=`, or `BETWEEN` on `ptstart` / `ptend`
- Updated UI default Denodo SQL instruction in `projectResolver.ts` with the same rule.
- Added focused prompt test assertions for equality-only partition guidance.
- Verified:
  - `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py src/pipelines/generation/sql_generation.py src/pipelines/generation/followup_sql_generation.py src/pipelines/generation/sql_generation_reasoning.py src/pipelines/generation/followup_sql_generation_reasoning.py src/pipelines/generation/denodo_subquery_generation.py src/pipelines/generation/sql_correction.py src/pipelines/generation/utils/sql.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `cd wren-ui && yarn check-types`
  - `git diff --check`
- Not verified with live Denodo / GraphQL rerun after this prompt fix.

## 2026-05-21 17:58 CST

- Implemented smart-assignment conversion metric mapping to `dv_assign_total_conversion_core`.
- Updated AI service Denodo prompt context to:
  - add `dv_assign_total_conversion_core` as the smart-assignment conversion-detail constant
  - prioritize it for smart-assignment lead count, order count, conversion rate, and converted amount questions when it is retrieved
  - inject the dedicated formulas: distinct `clew_id`, distinct paid `biz_order_no` with `is_ord_fdpay = 1`, expanded conversion-rate expression, and `actual_price`
  - stop injecting the old smart-assignment `converted_order_count / assigned_clew_count` formula
- Updated Denodo scope handling so smart-assignment metric questions override to `primaryModel=dv_assign_total_conversion_core` only when that candidate exists.
- Added focused tests for formula text, document priority, and scope override.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/scope_resolution.py wren-ai-service/src/web/v1/services/ask.py`
  - `git diff --check`
- Not verified:
  - Focused pytest could not run in this shell because `poetry` is not on PATH and system Python has no `pytest`.
  - Live Denodo / GraphQL execution still needs a rerun after AI service restart.

## 2026-05-21 18:14 CST

- Strengthened smart-assignment conversion metric prompts after a rerun still produced semantically wrong SQL with `COUNT(*)`, `is_ord_pay`, and `SUM(CASE ... THEN 1 ELSE 0 END)`.
- Promoted the dedicated `dv_assign_total_conversion_core` formula into Denodo SQL-output constraints for:
  - SQL generation
  - follow-up SQL generation
  - SQL generation reasoning
  - follow-up SQL generation reasoning
  - Denodo subquery generation
  - SQL correction
- Updated the business formula instruction to explicitly forbid `COUNT(*)`, `is_ord_pay`, and summed 1/0 counts for smart-assignment conversion metrics.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/sql_generation.py wren-ai-service/src/pipelines/generation/followup_sql_generation.py wren-ai-service/src/pipelines/generation/sql_generation_reasoning.py wren-ai-service/src/pipelines/generation/followup_sql_generation_reasoning.py wren-ai-service/src/pipelines/generation/denodo_subquery_generation.py wren-ai-service/src/pipelines/generation/sql_correction.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `git diff --check`
- Not verified:
  - Focused pytest still cannot run in this shell because system Python has no `pytest`.
  - Live Denodo / GraphQL execution still needs a rerun after AI service restart.

## 2026-05-21 21:19 CST

- Implemented file-persisted metric formula knowledge management.
- Added UI server-side `MetricFormulaService`:
  - `METRIC_FORMULAS_FILE` override
  - fallback to `dirname(SQLITE_FILE)/metric-formulas.json`
  - final fallback to `wren-ui/data/metric-formulas.json`
  - default smart-assignment conversion formula
  - atomic temp-file write plus rename
- Added REST API:
  - `GET /api/v1/knowledge/metric-formulas`
  - `POST /api/v1/knowledge/metric-formulas`
  - `PUT /api/v1/knowledge/metric-formulas/[id]`
  - `DELETE /api/v1/knowledge/metric-formulas/[id]`
- Added Knowledge UI route `/knowledge/metric-formulas` under the Knowledge sidebar after "指令".
- Wired Ask hot-update path:
  - `AskingService.createAskingTask` reads enabled formulas for Denodo projects before each Ask.
  - `WrenAIAdaptor.ask` sends `metric_formulas`.
  - AI service `AskRequest` accepts metric formulas.
  - Denodo prompt context matches formulas by data source, trigger phrase, and retrieved/selected model, then injects runtime instructions and can override scope to the formula primary model.
- Added focused AI service tests for file-backed formula instruction injection, retrieval prioritization, and scope override.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/web/v1/services/ask.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `cd wren-ui && yarn check-types`
  - `cd wren-ui && yarn next lint --file src/pages/knowledge/metric-formulas.tsx --file src/apollo/server/services/metricFormulaService.ts --file src/pages/api/v1/knowledge/metric-formulas/index.ts --file 'src/pages/api/v1/knowledge/metric-formulas/[id].ts' --file src/apollo/server/services/askingService.ts --file src/common.ts --file src/components/sidebar/Knowledge.tsx --file src/apollo/server/models/adaptor.ts --file src/apollo/server/repositories/apiHistoryRepository.ts`
  - `git diff --check`
- Not verified:
  - Full `yarn lint` still fails on unrelated pre-existing files in the dirty worktree.
  - Direct AI module smoke import failed because local system Python lacks `hamilton`.
  - Live UI/API and Denodo Ask hot-update behavior still need runtime verification.

## 2026-05-22 00:12 CST

- Added the default file-backed metric formula `denodo_clew_overview_conversion`.
- Scope:
  - primary model: `dv_clew_core`
  - required model: `dv_ord_core`
- Captured the 6.11-style business logic:
  - use `niche_id` as the standard lead-to-order attribution key
  - aggregate leads by `niche_id` first and keep earliest clue creation date
  - only count orders whose creation time is after the earliest clue date
  - default to no-refund effective order metrics with `is_ord_fdpay = 1`
  - use `is_ord_pay = 1` only when the user explicitly asks for with-refund / refund-included metrics
  - count order volume as converted opportunities, not raw order detail rows
- Updated current local `wren-ui/data/metric-formulas.json` with the same formula.
- Verification:
  - `jq empty wren-ui/data/metric-formulas.json`
  - `cd wren-ui && yarn check-types`
  - `cd wren-ui && yarn next lint --file src/apollo/server/services/metricFormulaService.ts --file src/pages/knowledge/metric-formulas.tsx --file src/pages/api/v1/knowledge/metric-formulas/index.ts --file 'src/pages/api/v1/knowledge/metric-formulas/[id].ts'`
- Not verified:
  - Live Denodo Ask for the 6.11-style full-lead conversion question.

## 2026-05-22 00:18 CST

- Corrected metric-formula monetary casts from `DOUBLE` to `DECIMAL(18, 2)`.
- Updated:
  - `wren-ui/src/apollo/server/services/metricFormulaService.ts`
  - `wren-ui/data/metric-formulas.json`
  - `wren-ai-service/src/pipelines/generation/denodo_prompt_context.py`
  - `wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
- Rationale: Denodo monetary amount expressions should preserve currency precision with `DECIMAL(18, 2)`; leaving the built-in prompt on `DOUBLE` would conflict with file-backed formulas.
- Verification:
  - `rg "actual_price.*DOUBLE|DOUBLE.*actual_price" wren-ui/src/apollo/server/services/metricFormulaService.ts wren-ui/data/metric-formulas.json wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/tests/pytest -n`
  - `jq empty wren-ui/data/metric-formulas.json`
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `cd wren-ui && yarn check-types`
  - `cd wren-ui && yarn next lint --file src/apollo/server/services/metricFormulaService.ts --file src/pages/knowledge/metric-formulas.tsx --file src/pages/api/v1/knowledge/metric-formulas/index.ts --file 'src/pages/api/v1/knowledge/metric-formulas/[id].ts'`

## 2026-05-22 00:25 CST

- Added the default file-backed metric formula `denodo_niche_drive_conversion`.
- Scope:
  - primary model: `admin.dv_niche_ord_conversion_core`
  - schema-qualified matching also accepts retrieved/candidate model `dv_niche_ord_conversion_core`
- Captured the smart-assignment test-drive conversion logic from the Word 6.6/6.9 examples plus user-provided view description:
  - use the niche order conversion helper view for smart-assignment test-drive conversion
  - filter the test-drive population with `ai_assign_drive_cnt > 0`
  - use distinct `clew_id` for test-drive lead count
  - use distinct paid `biz_order_no` with `is_ord_fdpay = 1` for effective converted orders
  - cast `actual_price` as `DECIMAL(18, 2)` for converted amount
  - do not rebuild attribution through `mobile_md5 = phone_no_md5`, `dv_clew_core`, `dv_ord_core`, or `dv_assign_total_conversion_core`
- Updated AI dynamic formula matching so schema-qualified configured models can match unqualified retrieved table/model names.
- Verification:
  - `jq empty wren-ui/data/metric-formulas.json`
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `cd wren-ui && yarn check-types`
  - `cd wren-ui && yarn next lint --file src/apollo/server/services/metricFormulaService.ts --file src/pages/knowledge/metric-formulas.tsx --file src/pages/api/v1/knowledge/metric-formulas/index.ts --file 'src/pages/api/v1/knowledge/metric-formulas/[id].ts'`
  - `git diff --check`
- Not verified:
  - Live Denodo Ask for 6.6/6.9-style smart-assignment test-drive conversion questions.

## 2026-05-22 00:31 CST

- Tightened dynamic Denodo metric-formula required-model semantics.
- Before: a formula could inject when the primary model was present even if `requiredModels` were missing.
- Now: matching requires `primaryModel` and all `requiredModels` to be present in the retrieved/candidate model set.
- Added tests for:
  - no instruction injection when a required model is absent
  - scope override flipping reversed selected models back to the formula-defined primary/secondary order
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `git diff --check`

## 2026-05-22 00:35 CST

- Changed dynamic Denodo metric-formula matching to scope-only.
- `triggerPhrases` and `exampleQuestions` remain in the JSON/UI as documentation and examples, but are no longer required for formula injection, retrieval priority, or scope override.
- Effective formula matching conditions:
  - Denodo context
  - formula `enabled = true`
  - formula `dataSource = denodo`
  - `primaryModel` is present in retrieved/candidate models
  - all `requiredModels` are present in retrieved/candidate models
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `git diff --check`

## 2026-05-22 00:48 CST

- Fixed runtime metric-formula precedence for Denodo prompt injection.
- Root cause: AI service still injected the built-in smart-assignment business formula after file-backed formulas, and several Denodo planning/generation/correction prompt blocks carried static smart-assignment wording. A user-edited formula could therefore be present but still be contradicted by old `is_ord_fdpay` / amount-cast guidance.
- Changed:
  - `build_denodo_runtime_instructions` now injects matching file-backed metric formulas before built-in business formulas.
  - When a file-backed metric formula matches the selected/retrieved scope, the built-in `denodo_business_formula_rules` fallback is skipped.
  - Denodo reasoning, final generation, follow-up generation, subquery generation, and correction prompt blocks now say runtime metric formulas are the source of truth instead of restating a hardcoded smart-assignment formula.
- Added focused test coverage that a saved smart-assignment formula using `is_conver_order` suppresses the old built-in `is_ord_fdpay` formula.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/sql_generation_reasoning.py wren-ai-service/src/pipelines/generation/followup_sql_generation_reasoning.py wren-ai-service/src/pipelines/generation/sql_generation.py wren-ai-service/src/pipelines/generation/followup_sql_generation.py wren-ai-service/src/pipelines/generation/denodo_subquery_generation.py wren-ai-service/src/pipelines/generation/sql_correction.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py -q`
  - `git diff --check`

## 2026-05-22 01:10 CST

- Added a file-backed Denodo metric formula for option-package popularity and package-price uplift.
- Formula id: `denodo_package_order_metrics`.
- Scope:
  - primary model: `dv_package_order_core`
  - required models: none
- Captured the package-ranking business logic:
  - group by `package_name`
  - rank package popularity by `COUNT(DISTINCT "biz_order_no")`
  - calculate average package price/uplift with `ROUND(AVG(CAST("package_price" AS DECIMAL(18, 2))), 2)`
  - optionally calculate package revenue with `ROUND(SUM(CAST("package_price" AS DECIMAL(18, 2))), 2)`
  - use `order_year_month` for month filtering
  - forbid falling back to `dv_ord_core`, `city_name`, `option_amount`, or `SUM("order_count")`
- Updated the default formula seed and current runtime `wren-ui/data/metric-formulas.json`.
- Verification:
  - `jq empty wren-ui/data/metric-formulas.json`
  - `python3 -m py_compile wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/src/pipelines/generation/denodo_prompt_context.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py -q`
  - `cd wren-ui && yarn check-types`
  - `cd wren-ui && yarn next lint --file src/apollo/server/services/metricFormulaService.ts --file src/pages/knowledge/metric-formulas.tsx --file src/pages/api/v1/knowledge/metric-formulas/index.ts --file 'src/pages/api/v1/knowledge/metric-formulas/[id].ts'`
  - `git diff --check`

## 2026-05-22 01:25 CST

- Fixed Denodo scope routing for lead-source conversion questions.
- Root cause: after metric formulas became scope-only, candidate sets containing both `dv_assign_total_conversion_core` and `dv_clew_core`/`dv_ord_core` could be biased by formula file order. A non-smart-assignment question such as "按线索四级来源目录统计今年累计的线索量和对应的订单转化率" could therefore select `dv_assign_total_conversion_core` and then use `channel_id` as a fallback dimension.
- Changed:
  - Added a narrow detector for non-smart-assignment lead-source conversion questions: lead source/channel + lead count + conversion rate.
  - Retrieval document prioritization now puts `dv_clew_core` then `dv_ord_core` before smart-assignment candidates for that pattern when both required models are present.
  - Scope override now forces `primaryModel=dv_clew_core`, `secondaryModels=["dv_ord_core"]`, and `needsJoin=true` for that pattern when both candidate models are available.
  - The line-clue-overview metric formula instructions now explicitly mention "线索四级来源目录 / 来源渠道转化率" and warn not to switch to `dv_assign_total_conversion_core` just because it has `channel_id`.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/web/v1/services/ask.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/services/test_ask_runtime_instructions.py -q`
  - `jq empty wren-ui/data/metric-formulas.json`
  - `cd wren-ui && yarn check-types`
  - `cd wren-ui && yarn next lint --file src/apollo/server/services/metricFormulaService.ts --file src/pages/knowledge/metric-formulas.tsx --file src/pages/api/v1/knowledge/metric-formulas/index.ts --file 'src/pages/api/v1/knowledge/metric-formulas/[id].ts'`
  - `git diff --check`

## 2026-05-22 01:34 CST

- Added an explicit scope-resolution prompt patch for lead-source conversion questions.
- Prompt rule now says Denodo lead-source/source-channel/source-catalog/fourth-level-source questions that ask for lead count and order conversion rate should select `primary_model = dv_clew_core`, `secondary_models = ["dv_ord_core"]`, and `needs_join = true` when both models are candidates.
- The same rule explicitly says not to choose `dv_assign_total_conversion_core` for these general lead-source questions unless the user explicitly asks for smart assignment, assignment strategy, assigned leads, or post-assignment, and not to substitute `dv_assign_total_conversion_core.channel_id` for a missing fourth-level source field.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/scope_resolution.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py -q`
  - `git diff --check`

## 2026-05-22 01:42 CST

- Increased AI service table retrieval candidate scope from 5 to 10.
- Changed:
  - `wren-ai-service/src/config.py`: `Settings.table_retrieval_size` default is now 10.
  - `wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py`: `DbSchemaRetrieval` constructor default is now 10.
  - local ignored runtime file `wren-ai-service/config.yaml`: `table_retrieval_size: 10` for immediate restart behavior in this workspace.
- Rationale: scope resolution can only choose from retrieved candidate models; expanding table retrieval to 10 gives Denodo lead-source questions a better chance to include both `dv_clew_core` and `dv_ord_core`.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/config.py wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py`
  - `poetry run pytest tests/pytest/test_config.py -q`
  - `git diff --check`

## 2026-05-22 02:08 CST

- Extended Denodo general lead-conversion routing beyond lead-source questions.
- Root cause: a question such as "3 月的全量线索大定支付转化率是多少？如果剔除退订订单..." retrieved both `dv_clew_core`/`dv_ord_core` and `dv_assign_total_conversion_core`, but scope selection still chose the smart-assignment table because it exposed convenient paid-order fields.
- Changed:
  - Added a non-smart-assignment lead-overview detector for all-leads/full-lead/line-clue-overview/large-deposit conversion/refund-included/no-refund conversion wording.
  - Retrieval prioritization and AskService scope override now force `primaryModel=dv_clew_core`, `secondaryModels=["dv_ord_core"]`, and `needsJoin=true` for these questions when both models are available.
  - Scope-resolution prompt rule now covers all-leads/full-lead/lead-overview questions and explicitly says not to use `assign_year_month` or `dv_assign_total_conversion_core` unless the user asks for smart assignment.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/scope_resolution.py wren-ai-service/src/web/v1/services/ask.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py -q`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py -q`
  - `git diff --check`

## 2026-05-22 15:20 CST

- Updated the file-backed `denodo_clew_overview_conversion` formula for Denodo pushdown constraints.
- Root cause: placing `order_date >= min_clew_date` in a final `LEFT JOIN ON` is not the desired Denodo shape; the attribution predicate needs to live inside an order-attribution CTE `WHERE` clause.
- Superseded at 15:24 CST: the latest desired shape is conditional aggregation, not pre-`WHERE` then join.
- Changed:
  - Runtime `wren-ui/data/metric-formulas.json` and the default formula seed in `MetricFormulaService` now require a fixed three-stage shape: `leads_per_niche`, `orders_per_niche`, final summary.
  - `orders_per_niche` uses `leads_per_niche` joined to `dv_ord_core` and must put the order-date attribution predicate in `WHERE`, for example `WHERE "o"."order_date" >= "l"."min_clew_date"`.
  - The final summary must still start from `leads_per_niche` and `LEFT JOIN orders_per_niche` to preserve no-order leads in the denominator.
- Verification:
  - `jq empty wren-ui/data/metric-formulas.json`
  - `cd wren-ui && yarn check-types`
  - AI service runtime-instruction smoke check confirmed `orders_per_niche`, `WHERE "o"."order_date" >= "l"."min_clew_date"`, and final `LEFT JOIN orders_per_niche`
  - `cd wren-ui && yarn next lint --file src/apollo/server/services/metricFormulaService.ts`
  - `git diff --check`

## 2026-05-22 15:24 CST

- Revised the file-backed `denodo_clew_overview_conversion` formula to use conditional aggregation for order attribution.
- Root cause: user clarified the desired Denodo shape is not "pre-WHERE then join"; the order-date attribution predicate must live inside the order metric `CASE WHEN`.
- Changed:
  - Runtime `wren-ui/data/metric-formulas.json` and default `MetricFormulaService` seed now express order count, conversion rate, refund impact, and amount metrics with `order_date >= min_clew_date` inside `CASE WHEN`.
  - Extra instruction now explicitly forbids modeling this as "先 WHERE 过滤再 JOIN" or as a join-only attribution predicate.
  - Target pattern: `COUNT(DISTINCT CASE WHEN "has_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)`, with generated SQL expanding actual aliases such as `o.is_ord_fdpay` and `l.min_clew_date`.
- Verification:
  - `jq empty wren-ui/data/metric-formulas.json`
  - `cd wren-ui && yarn check-types`
  - AI service runtime-instruction smoke check confirmed the conditional count pattern and alias-expanded example
  - `cd wren-ui && yarn next lint --file src/apollo/server/services/metricFormulaService.ts`
  - `git diff --check`

## 2026-05-22 15:37 CST

- Fixed Denodo rounded-rate casts for PostgreSQL/JDBC pushdown.
- Root cause: Denodo technical and generation rules still told the model to use `FLOAT` for rates. Generated SQL with `ROUND(CAST(... AS FLOAT) * 100.0 / ..., 2)` can fail after Denodo/JDBC pushdown as `round(double precision, integer)`.
- Changed:
  - Denodo technical rules now require `DECIMAL(18, 6)` casts for rounded rates/percentages and explicitly forbid `CAST(... AS FLOAT)` / DOUBLE inside `ROUND(expr, scale)`.
  - SQL generation, follow-up generation, and default SQL rule prompts now carry the same constraint.
  - File-backed runtime formulas and default seeds for smart-assignment conversion, line-clue-overview conversion, and smart-assignment test-drive conversion now use `CAST(... AS DECIMAL(18, 6)) * CAST(100 AS DECIMAL(18, 6)) / NULLIF(CAST(... AS DECIMAL(18, 6)), 0)`.
  - Line-clue-overview forbidden patterns now include `CAST(... AS FLOAT)` and `ROUND(CAST(... AS FLOAT)`.
  - Line-clue-overview instructions now forbid `paid_flag` as the refund-included order flag and require `LEFT JOIN dv_ord_core` from `leads_per_niche`, not `INNER JOIN`, to preserve no-order lead denominators.
- Verification:
  - `jq empty wren-ui/data/metric-formulas.json`
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/sql_generation.py wren-ai-service/src/pipelines/generation/followup_sql_generation.py wren-ai-service/src/pipelines/generation/utils/sql.py`
  - `cd wren-ui && yarn check-types`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py -q`
  - `poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py -q`
  - Runtime-instruction smoke check confirmed `DECIMAL(18, 6)`, no old `AS FLOAT) * 100.0` expression, `LEFT JOIN dv_ord_core`, and `paid_flag` forbidden patterns
  - `cd wren-ui && yarn next lint --file src/apollo/server/services/metricFormulaService.ts`
  - `git diff --check`

## 2026-05-22 16:04 CST

- Added an AI-service-only hidden Denodo SQL exemplar for the full-lead conversion/refund-comparison test question.
- Rationale: normal SQL pairs are visible/retrievable in the reasoning prompt and knowledge UI. This exemplar must be available for final SQL generation/correction while staying out of frontend planning/reasoning.
- Changed:
  - Added rule matching for same-semantics questions around full-lead/line-clue overview large-deposit conversion rate with refund-included versus refund-excluded comparison.
  - Supports explicit month variants like `3月`, `4月`, `202604`, and relative `上个月`, resolving `target_yyyymm`, start date, and end date.
  - Requires selected models to include both `dv_clew_core` and `dv_ord_core`.
  - Injects a private `INTERNAL HIDDEN SQL EXEMPLAR` section only into final SQL generation, follow-up SQL generation, and SQL correction prompts.
  - Does not pass the exemplar to `sql_generation_reasoning`, `followup_sql_generation_reasoning`, query decomposition, GraphQL response, or UI fields.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/sql_generation.py wren-ai-service/src/pipelines/generation/followup_sql_generation.py wren-ai-service/src/pipelines/generation/sql_correction.py wren-ai-service/src/web/v1/services/ask.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_hidden_exemplar_prompts.py`
  - `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/pipelines/generation/test_denodo_hidden_exemplar_prompts.py -q`
  - `poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py -q`
  - Smoke check confirmed a `4月` variant matches the hidden exemplar and resolves `202604`
  - `git diff --check`

## 2026-05-22 16:35 CST

- Replaced the hidden full-lead conversion/refund-comparison SQL exemplar with the user-provided benchmark SQL shape.
- Changed:
  - `wren-ai-service/src/pipelines/generation/denodo_prompt_context.py` now stores the hidden template as `leads_per_niche` plus `orders_per_niche`.
  - Explicit month windows are parameterized as compact date keys: `create_date >= '{start_date_key}'` and `create_date < '{next_month_start_date_key}'`.
  - `orders_per_niche` joins `dv_ord_core` to `leads_per_niche`, applies `WHERE order_date_key >= l.min_clue_date`, aggregates `has_ord_pay`, `has_ord_fdpay`, `total_amt_pay`, and `total_amt_fdpay`, and the final query `LEFT JOIN`s those order aggregates back to all leads.
  - Hidden exemplar tests now assert the `orders_per_niche`, `order_date_key >= l.min_clue_date`, `gross_order_amount`, and final `LEFT JOIN orders_per_niche` structure.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/sql_generation.py wren-ai-service/src/pipelines/generation/followup_sql_generation.py wren-ai-service/src/pipelines/generation/sql_correction.py wren-ai-service/src/web/v1/services/ask.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_hidden_exemplar_prompts.py`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/pipelines/generation/test_denodo_hidden_exemplar_prompts.py -q`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py -q`
  - Poetry smoke check confirmed the March question matches and contains `20260301`, `20260401`, `orders_per_niche AS`, `WHERE order_date_key >= l.min_clue_date`, final `LEFT JOIN orders_per_niche`, and `gross_order_amount`
  - `git diff --check`

## 2026-05-22 16:48 CST

- Hardened the hidden Denodo full-lead conversion exemplar against `round(double precision, integer)` pushdown failures.
- Changed:
  - `wren-ai-service/src/pipelines/generation/denodo_prompt_context.py` now renders the private full-lead exemplar with `DECIMAL(18, 6)` and `CAST(100 AS DECIMAL(18, 6))` instead of `100.0`.
  - Added a regression test in `wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py` that asserts the hidden exemplar contains `CAST(100 AS DECIMAL(18, 6))` and does not contain `* 100.0`.
- Verification:
  - `cd wren-ai-service && poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py -q`
  - Result: `19 passed`

## 2026-05-22 17:04 CST

- Removed the legacy Denodo SQL rewrite that converted count-based conversion-rate casts back to `FLOAT`.
- Root cause: prompt and metric-formula rules already required `DECIMAL(18, 6)`, but `wren-ui/src/apollo/server/utils/denodoMcp.ts` still had `forceFloatForCountRate`, so UI SQL rewriting could emit `CAST(... AS FLOAT)` before Denodo MCP validation and re-trigger `round(double precision, integer)`.
- Changed:
  - Deleted `forceFloatForCountRate`, `buildFloatTarget`, and count-like-column detection from the Denodo rewrite layer.
  - `toDenodoNativeSql` and `sanitizeDenodoDialectSql` now keep rate/percentage math as DECIMAL and normalize `FLOAT`/`DOUBLE`/`REAL`/`NUMBER` casts to `DECIMAL(18, 6)`.
  - Updated Denodo MCP tests that previously expected `AS FLOAT)` to expect `AS DECIMAL(18, 6)`.
  - Added a direct DIALECT sanitizer regression using a rounded conversion-rate expression with `CAST(... AS FLOAT)`, asserting the sanitized SQL no longer contains `FLOAT` or `DOUBLE`.
  - Added SQL correction prompt guidance for `round(double precision, integer)` errors to rewrite rounded rates with DECIMAL casts.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/sql_correction.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_hidden_exemplar_prompts.py`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/pipelines/generation/test_denodo_hidden_exemplar_prompts.py -q`
  - `cd wren-ui && /Applications/Codex.app/Contents/Resources/node .yarn/releases/yarn-4.5.3.cjs test src/apollo/server/utils/tests/denodoMcp.test.ts src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`
  - `cd wren-ui && /Applications/Codex.app/Contents/Resources/node .yarn/releases/yarn-4.5.3.cjs check-types`
  - `git diff --check`

## 2026-05-22 19:03 CST

- Rolled the dirty worktree back to clean commit `55c98fd5 feat: add denodo metric formula guidance`, removed the explicitly requested untracked `scripts/customer-source-package.sh`, and then reworked Denodo scope selection to be model-led.
- Changed:
  - Removed deterministic selected-model rewrites from `_override_denodo_scope_for_known_patterns(...)`; it now preserves the LLM scope result.
  - Changed `prioritize_conversion_core_documents(...)` to preserve retrieval order rather than pushing conversion/metric-formula views to the front.
  - Added scope-resolution prompt guidance for full-order questions, option packages, city conversion decline, line-clue overview/source conversion, and smart-assignment conversion.
  - Passed metric formulas into scope resolution as optional business hints, while keeping formula SQL instructions gated by selected-model narrowing.
  - Prevented pre-scope runtime instruction construction from injecting business formulas based on the full retrieved top-N model set.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/scope_resolution.py wren-ai-service/src/web/v1/services/ask.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py tests/pytest/pipelines/generation/test_denodo_prompt_context.py -q` (`41 passed`)
  - `git diff --check`

## 2026-05-25 14:18 CST

- Removed the global Denodo prompt rule that forced percentage multipliers to a casted DECIMAL constant.
- Changed:
  - Denodo technical rules, final SQL generation, follow-up SQL generation, SQL correction, and default SQL rules now preserve the percentage multiplier shape from runtime metric formulas when one is provided.
  - The private full-lead conversion/refund-comparison hidden exemplar now uses `100.0` as the multiplier while still casting numerator and denominator to `DECIMAL(18, 6)`.
  - Updated the hidden exemplar regression test accordingly.
- Verification:
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/sql_generation.py wren-ai-service/src/pipelines/generation/followup_sql_generation.py wren-ai-service/src/pipelines/generation/sql_correction.py wren-ai-service/src/pipelines/generation/utils/sql.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/services/test_ask_runtime_instructions.py -q` (`41 passed`)
  - `git diff --check`

## 2026-05-25 14:47 CST

- Cleaned Denodo prompt / metric-formula / hidden-exemplar cast guidance.
- Changed:
  - Removed metric-calculation `DECIMAL(18, 6)` / `DECIMAL(18, 2)` cast requirements from Denodo technical rules, final SQL generation, follow-up SQL generation, SQL correction, and default SQL rules.
  - Updated the private full-lead conversion/refund-comparison hidden exemplar so rates and refund impact use the user-provided direct `COUNT(...) * 100.0 / NULLIF(...)` shape with no added casts.
  - Updated default metric-formula seeds and the active `wren-ui/data/metric-formulas.json` formulas to avoid instructing the model to cast rates, amounts, or package prices.
  - Kept UI Denodo SQL sanitizer behavior separate: it may still normalize already-generated `TO_NUMBER` or `FLOAT`/`DOUBLE` casts before validation, but prompt/formula layers should not introduce those casts.
- Verification:
  - `node -e "JSON.parse(require('fs').readFileSync('wren-ui/data/metric-formulas.json','utf8')); console.log('json ok')"`
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/denodo_prompt_context.py wren-ai-service/src/pipelines/generation/sql_generation.py wren-ai-service/src/pipelines/generation/followup_sql_generation.py wren-ai-service/src/pipelines/generation/sql_correction.py wren-ai-service/src/pipelines/generation/utils/sql.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/services/test_ask_runtime_instructions.py -q` (`41 passed`)
  - `cd wren-ui && /Applications/Codex.app/Contents/Resources/node .yarn/releases/yarn-4.5.3.cjs check-types`
  - `git diff --check`

## 2026-05-25 15:12 CST

- Fixed line-clue overview conversion formula guidance for dimensioned questions.
- Root cause:
  - Ask `226068d9-5000-4865-b29d-412122cd12ec` failed because generated SQL built `leads_per_level` grouped only by `clew_level`, then tried to reference `l.niche_id` in `orders_per_level`.
  - Denodo validate failed quickly with `Field not found 'l.niche_id' in view 'l'`; AI correction query `e1c40897-03cb-4140-b6b0-fff2ad1bca38` later finished, but UI had already hit its 60s correction polling timeout.
- Changed:
  - Default and active line-clue metric formulas now explicitly require lead CTEs for dimensioned analysis to select and group by `niche_id + all display/group dimensions`.
  - Order-side aggregation and final joins must preserve the same keys; final SELECT then rolls up to the display dimensions.
  - Added AI-service regression coverage that the file-backed metric formula instruction is injected.
- Verification:
  - `node -e "JSON.parse(require('fs').readFileSync('wren-ui/data/metric-formulas.json','utf8')); console.log('json ok')"`
  - `python3 -m py_compile wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py -q` (`20 passed`)
  - `cd wren-ui && /Applications/Codex.app/Contents/Resources/node .yarn/releases/yarn-4.5.3.cjs check-types`
  - `git diff --check`

## 2026-05-26 13:51 CST

- Corrected Denodo scope guidance for lead-level conversion questions.
- Changed:
  - `scope_resolution.py` now states that lead-level questions such as `线索等级`, `不同等级线索`, H/A/B/C lead levels, or `clew_level` with conversion rate/order count/output amount should prefer `dv_assign_total_conversion_core`.
  - The default and active `denodo_assign_total_conversion` formula now includes lead-level trigger phrases and an instruction that lead-level conversion/output amount belongs to the smart-assignment business chain.
  - The line-clue overview formula no longer lists lead level as a general line-clue overview dimension and explicitly defers lead-level conversion/amount to `dv_assign_total_conversion_core`.
  - Added focused tests for the scope prompt and file-backed formula injection.
- Verification:
  - `node -e "JSON.parse(require('fs').readFileSync('wren-ui/data/metric-formulas.json','utf8')); console.log('json ok')"`
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/scope_resolution.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/services/test_ask_runtime_instructions.py -q` (`43 passed`)
  - `cd wren-ui && /Applications/Codex.app/Contents/Resources/node .yarn/releases/yarn-4.5.3.cjs check-types`
  - `git diff --check`

## 2026-05-26 14:20 CST

- Corrected Denodo scope/formula guidance for assigned-store cross-region purchase questions.
- Changed:
  - Scope resolution now says assigned-store cross-region purchase terms such as `分配给门店`, `fac_name`, `跨区购车`, `上牌城市≠交付城市`, and `is_cross_order` belong to `dv_assign_total_conversion_core`, not `dv_clew_assign_core`.
  - Default and active `denodo_assign_total_conversion` formulas now include cross-region trigger phrases and expressions for cross-region order count, cross-region rate, and cross-region amount.
  - Formula guidance tells SQL generation to group stores by `fac_name`, use `is_cross_order = 1` rather than manual city comparison, require `is_conver_order = 1` for converted orders, use `actual_price`, and apply equality-only `ptstart` / `ptend` boundaries.
  - Added focused tests for the scope prompt and file-backed formula injection.
- Verification:
  - `node -e "JSON.parse(require('fs').readFileSync('wren-ui/data/metric-formulas.json','utf8')); console.log('json ok')"`
  - `python3 -m py_compile wren-ai-service/src/pipelines/generation/scope_resolution.py wren-ai-service/tests/pytest/pipelines/generation/test_denodo_prompt_context.py wren-ai-service/tests/pytest/services/test_ask_runtime_instructions.py`
  - `/Users/qianchenghu/.local/bin/poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/services/test_ask_runtime_instructions.py -q` (`44 passed`)
  - `cd wren-ui && /Applications/Codex.app/Contents/Resources/node .yarn/releases/yarn-4.5.3.cjs check-types`
  - `git diff --check`

## 2026-05-26 15:05 CST

- Added a prompt-injection inventory for the repository.
- Changed:
  - Created `docs/customer-facing/denodo-prompts/PROMPT_INJECTION_MAP.md` to list direct LLM prompt files, indirect context sources, and editing boundaries.
  - Documented the central LiteLLM boundary, SQL/Denodo prompt paths, answer/chart/assistance prompts, semantic modeling helper prompts, UI-forwarded prompt context, and config files that only select providers.
- Verification:
  - Static source inspection with `rg` and targeted file reads; no service tests were run because this is documentation-only.

## 2026-05-26 15:40 CST

- Added a Chinese Denodo prompt-layer inventory focused on actual injected prompt content.
- Changed:
  - Created `docs/customer-facing/denodo-prompts/DENODO_PROMPT_LAYERS.zh-CN.md` with Denodo SQL rule, business context, semantic context, SQL generation input, internal planning/hidden, and user/history instruction layers.
  - Redacted code source locations, SQL pair contents, and hidden SQL exemplar details; examples use placeholders instead of real SQL pairs or internal exemplar SQL.
  - Updated the document for customer-facing review by removing direct internal product/system naming and replacing SQL-pair terminology with neutral historical-example placeholders.
- Verification:
  - Static document review only; confirmed no `Wren`, `SQL pair`, `MCP`, or `AI service` wording remains in the customer-facing prompt-layer document. No service tests were run because this is documentation-only.

## 2026-05-26 16:05 CST

- Expanded the customer-facing Denodo prompt-layer inventory for metric calculation platform rules.
- Changed:
  - Added how enabled metric rules influence view selection through pre-generation summaries.
  - Documented how matched metric rules optimize SQL generation through authoritative expressions, forbidden patterns, required views, and correction-stage reinjection.
  - Clarified the two-stage injection timing: lightweight rule summaries before scope selection, full matched rule instructions after the selected view boundary is known.
- Verification:
  - Static document review only; no business logic or tests were changed for this documentation update.

## 2026-05-27 14:03 CST

- Added an independent customer-facing Denodo prompt reference document.
- Changed:
  - Created `docs/customer-facing/denodo-prompts/DENODO_PROMPT_REFERENCE.zh-CN.md` with system, Denodo technical rules, metric platform rules, business context, semantic context, scope/SQL input, complex planning, user/history instruction, and final injection-order layers.
  - Included implementation-source references with service-relative paths, function/class names where useful, and line numbers for traceability.
  - Kept historical reference examples as placeholders and avoided internal product naming or private mechanism terminology in the customer-facing document.
- Verification:
  - Static document review only; no business logic or service tests were changed for this documentation update.

## 2026-05-27 15:44 CST

- Moved prompt explanation documents out of the `/ai` memory directory into a dedicated documentation path.
- Changed:
  - Created `docs/customer-facing/denodo-prompts/` as the home for customer-facing Denodo prompt documents.
  - Moved `DENODO_PROMPT_LAYERS.zh-CN.md`, `DENODO_PROMPT_REFERENCE.zh-CN.md`, and `PROMPT_INJECTION_MAP.md` from `/ai` into that directory.
  - Updated active memory references to point at the new documentation path.
- Verification:
  - Static path/status review only; no business logic or service tests were changed for this documentation move.

## 2026-05-27 15:47 CST

- Expanded the customer-facing Denodo prompt reference with all current metric calculation prompt rules.
- Changed:
  - Added the full enabled Denodo metric-rule catalog to `docs/customer-facing/denodo-prompts/DENODO_PROMPT_REFERENCE.zh-CN.md`.
  - Covered smart-assignment conversion, lead-overview conversion, smart-assignment test-drive conversion, and package-order metrics.
  - Included each rule's scope, trigger phrases, metric expressions, forbidden SQL patterns, and extra business instructions as injected prompt content.
- Verification:
  - Static document review only; no business logic or service tests were changed for this documentation update.
