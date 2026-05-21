# Tasks

Last updated: 2026-05-20 17:32 CST

Use stable task titles. Move completed items to `Done` with date and verification.

## Doing

- Validate/finish Denodo ask SQL trace and guard changes from current dirty worktree.
- Benchmark the new direct Denodo VQL generation path with the existing Denodo question sets; compare validate/correction count, ask total time, and generated VQL quality against prior runs.
- Prepare next SQL trace Markdown cleanup: de-duplicate repeated SQL and keep only each meaningful attempt.

## Todo

- Benchmark Denodo complex-query decomposition plus direct-VQL mode on customer-style questions and compare success rate, correction count, `ai.sql_generation` time, and ask total time.
- Re-run Q20 through the GraphQL asking-task path after the prompt/scope/partition/YYYYMM fixes; verify `selectedModels` are `dv_clew_ord_conversion_core` + `dm_ord_month_city`, generated SQL has no `LAG`, intermediate Top 5 is truly filtered, `dm_ord_month_city` has no `ptstart`/`ptend` predicate, no raw `MAX(order_year_month) - 12` arithmetic appears, and Denodo validate succeeds.
- Implement `scripts/ask-sql-trace-markdown.mjs` readability cleanup requested by the user: group by ask/question, remove duplicate SQL blocks, and show one folded block per attempt.
- Investigate why q12/q17/q19 selected/generated SQL referenced missing view `dv_clew_ord_conversion_core_new`.
- Re-run q20 or customer 10-question benchmark after confirming UI remains listening; previous q20 failed with `fetch failed` and no `ask_finished`.
- Investigate customer-side `clarification needed / no relevant SQL` observed after changing a 30000ms timeout; root cause not confirmed.
- Verify customer runtime after manual file replacement under `/data/wenai/poc`.
- Backfill concrete handoff notes for remaining Codex task agents: `6. 测试`, `2. 拉起项目 专用`.
- Run the 10-question benchmark with `scripts/denodo-vql-benchmark.mjs` and capture the result JSON for comparison.
- Keep Denodo SQL guard benchmark questions aligned with real customer language.
- Document confirmed ask timing trace workflow after current tracing work stabilizes.
- Evaluate semantic routing candidates for Denodo selected views:
  - order/payment/refund/delivery/conversion/city aggregation
  - single-model vs multi-model route
  - clarification vs generation threshold
- Explore MCP integration for schema, trace, docs, and evaluation tools.
- Optional: expand `.tmp/chatbi-poc-review-outline.md` into full interview answer scripts, especially Denodo semantic-view governance, RAG consumption, intent routing, and SQL quality layers.
- Optional: confirm whether `codex/customer-stable-20260513` should also fast-forward `origin/main`; only the `20260507` stable branch was pushed to `main` during this chat.

## Blocked

- Customer automated deploy scripting is blocked/undesirable because the customer host lacks `rsync` and is high risk; proceed with manual backup plus file-by-file transfer unless site tooling is confirmed.
- Some hard Denodo benchmark questions are blocked by missing view `dv_clew_ord_conversion_core_new` until schema/semantic-layer alignment is confirmed.

## Done

- 2026-05-15: Started `/ai` memory layer with operating manual, context, active state, decisions, tasks, and changelog.
- 2026-05-15: Added discovery pointers from root `AGENTS.md` and `.claude/CLAUDE.md` to `/ai`.
- 2026-05-15: Added current agent progress snapshot to `/ai/ACTIVE_STATE.md`.
- 2026-05-15: Corrected `ACTIVE_STATE.md` to track Codex task agents/threads instead of tool-brand agents.
- 2026-05-15: Drafted ignored resume/interview prep docs for ChatBI PoC:
  - `.tmp/resume-chatbi-poc.md`
  - `.tmp/chatbi-poc-review-outline.md`
  - Verification: files are under ignored `.tmp`; no service tests/builds run.
- 2026-05-15: Backfilled the current chat session into `/ai` memory files and reconciled the current dirty worktree / source-dev startup state.
  - Verification: read `/AGENTS.md`, `/ai/AGENTS.md`, `/ai/AI_CONTEXT.md`, `/ai/ACTIVE_STATE.md`, `/ai/TASKS.md`, `/ai/DECISIONS.md`, `/ai/CHANGELOG.md`, `git branch --show-current`, and `git status --short`.
- 2026-05-15: Backfilled `4. 分支管理` with customer stable branch handoff history.
  - Completed: created/pushed `codex/customer-stable-20260507` at `f4519dec`, fast-forwarded `origin/main` to `f4519dec`, created/pushed `codex/customer-stable-20260513` at `b1c966c4`, and deleted old `0507` branches.
  - Verification: git branch/ref checks from the chat history; no CI/app tests run for these branch operations.
- 2026-05-13: Ran local 20-question Denodo ask benchmark via GraphQL asking-task path; 16/20 succeeded, median successful duration about 161s, wall-clock about 82 minutes.
- 2026-05-13: Generated readable timing and SQL trace artifacts under `/tmp` for the 20-question run.
- 2026-05-15: Verified current SQL trace-related code with `py_compile`, `node --check`, `yarn check-types`, targeted Jest for `denodoSqlGuardService.test.ts`, and targeted Next lint; full lint still has unrelated pre-existing failures.
- 2026-05-15: Backfilled `5. AI SDK 生成 VQL` and `分析提问失败原因` into `/ai` memory from the current chat history.
  - Completed: recorded Denodo AI SDK assessment, Denodo skills zip assessment, current generic-SQL-to-VQL architecture, direct-VQL implementation plan, timing/SQL trace state, model config observation, and benchmark latency observation.
  - Verification: memory-only update; no business code changed during this backfill.
- 2026-05-15: Assessed Denodo AI SDK and Denodo skills package for VQL generation reuse.
  - Result: useful rule/prompt/fixer references exist, but no clean VQL-only generation/fixer API was found; full SDK flow is not a drop-in replacement for the current planning path.
- 2026-05-15: Captured later Denodo benchmark observation from chat: 22 questions, 3 rewrites, average latency around 4.5 minutes, with main cost in planning/generation.
- 2026-05-15: Implemented Denodo complex-query decomposition with parallel validated subquery drafts in AI service.
  - Changed: added `DenodoQueryDecomposition` and `DenodoSubqueryGeneration` pipelines; wired them into `AskService`; injected validated hidden subquery drafts into final SQL generation and correction; added code-level feature flags defaulting on.
  - Verification: `python -m py_compile` for modified AI service files; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_query_decomposition.py`; `poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py tests/pytest/pipelines/generation/test_denodo_prompt_context.py`; `poetry run python -c "from src.web.v1.services.ask import AskService; from src.pipelines import generation; print('ok')"`; `poetry run python -c "from src.globals import ServiceContainer; print('globals ok')"`.
  - Not verified: full Denodo benchmark/runtime behavior.
- 2026-05-15: Moved Denodo complex-query decomposition before SQL reasoning and exposed a safe UI decomposition summary.
  - Changed: AskService writes planning status after Denodo scope/query normalization, runs decomposition plus parallel subquery draft generation before `sql_generation_reasoning`, passes hidden decomposition context into normal/follow-up reasoning, and keeps validated subquery drafts for final generation/correction.
  - UI: GraphQL/adapter/client types now expose `queryDecomposition` with only `complexity`, `subqueryCount`, `cteName`, `objective`, and `grain`; `Organizing` displays it after selected scope and normalized query without exposing subquery SQL.
  - Verification: `python -m py_compile wren-ai-service/src/web/v1/services/ask.py wren-ai-service/src/pipelines/generation/denodo_query_decomposition.py wren-ai-service/src/pipelines/generation/sql_generation_reasoning.py wren-ai-service/src/pipelines/generation/followup_sql_generation_reasoning.py`; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_query_decomposition.py`; `poetry run pytest tests/pytest/services/test_timing_events.py`; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`; `cd wren-ui && yarn check-types`; `cd wren-ui && yarn test src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts --runInBand`.
  - Note: `yarn generate-gql` was attempted but failed because local `http://localhost:3000/api/graphql` returned 404; affected generated GraphQL files were updated manually.
  - Not verified: live Denodo benchmark/runtime behavior.
- 2026-05-15: Implemented direct Denodo VQL generation path in current dirty worktree.
  - Changed: Denodo generation/follow-up/subquery/correction now use VQL prompts; Denodo post-processing extracts VQL without AI-service Wren-engine validation; `AskResult` can serialize `sql_dialect: DIALECT`; UI Denodo prompt context includes native view/column mapping; UI guard skips `toDenodoNativeSql` for `DIALECT` candidates and keeps legacy conversion fallback.
  - Verification: `python -m py_compile` for modified AI service files; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/pipelines/generation/test_denodo_query_decomposition.py tests/pytest/services/test_timing_events.py tests/pytest/pipelines/test_sql_correction.py`; `cd wren-ui && yarn test src/apollo/server/services/tests/denodoSqlGuardService.test.ts src/apollo/server/utils/tests/denodoMcp.test.ts src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts --runInBand`; `cd wren-ui && yarn check-types`; `git diff --check`.
  - Not verified: live Denodo benchmark/runtime latency and validate/correction improvement.
- 2026-05-16: Fixed direct Denodo VQL `TO_NUMBER` projection issue for package-price uplift queries.
  - Changed: Denodo prompts now ban `TO_NUMBER`; UI guard sanitizes direct `DIALECT` SQL expressions before Denodo MCP validation without remapping native identifiers; `TO_NUMBER(x)` becomes `CAST(x AS DECIMAL(18, 2))`.
  - Verification: `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py`; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`; `cd wren-ui && yarn test src/apollo/server/utils/tests/denodoMcp.test.ts src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`; `cd wren-ui && yarn check-types`; `git diff --check`.
  - Not verified: live Denodo execution after this fix.
- 2026-05-16: Hardened Denodo guard against MCP validate exceptions on CTE-style VQL.
  - Changed: Denodo prompts discourage unnecessary CTEs for simple single-view aggregations; UI Denodo guard now converts validate tool exceptions such as `Cannot read properties of null (reading 'id')` into invalid validation attempts and enters the existing SQL correction loop.
  - Verification: `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py`; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`; `cd wren-ui && ./node_modules/.bin/jest src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`; `cd wren-ui && ./node_modules/.bin/tsc --noEmit`; `git diff --check`.
  - Not verified: live Denodo execution after this fix.
- 2026-05-16: Fixed Denodo scoped semantic context losing the direct-VQL marker.
  - Root cause: after scope resolution, AI service replaced the full Denodo semantic context with a scoped dictionary-only summary. This dropped `[[WREN_DENODO_CONTEXT]]` and native VQL schema context, so SQL generation/correction post-processing used generic Wren-engine dry-run and emitted `ai_initial_dry_run_failed` with `Cannot read properties of null (reading 'id')`.
  - Changed: added a scoped Denodo semantic context builder that preserves Denodo marker/native context and replaces only the semantic dictionary section.
  - Verification: `poetry run python -m py_compile src/web/v1/services/ask.py src/pipelines/generation/sql_generation.py src/pipelines/generation/sql_correction.py`; `poetry run pytest tests/pytest/services/test_ask_runtime_instructions.py tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/pipelines/generation/test_denodo_query_decomposition.py`; `cd wren-ui && ./node_modules/.bin/jest src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`; `git diff --check`.
  - Not verified: live Denodo execution after this fix.
- 2026-05-18: Implemented Denodo Q20 consecutive-decline SQL generation guidance and selected-model consistency fix.
  - Changed: Denodo technical rules now distinguish final-display Top-N from intermediate Top-N, forbid `LAG`/`LEAD` for consecutive month comparisons, require YYYYMM `month_index` self joins, and treat selected/retrieved schema as a hard table boundary.
  - Scope: Q20-like city conversion-rate consecutive-decline questions now override selected models to `primaryModel=dv_clew_ord_conversion_core`, `secondaryModels=["dm_ord_month_city"]`, `needsJoin=true` when both candidate models exist.
  - Prompts: scope resolution, decomposition, subquery generation, reasoning, final SQL generation, follow-up generation, and correction all carry the same Q20 structure; correction explicitly rewrites `Function lag is not executable` toward self joins.
  - Verification: `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py src/pipelines/generation/scope_resolution.py src/pipelines/generation/denodo_query_decomposition.py src/pipelines/generation/denodo_subquery_generation.py src/pipelines/generation/sql_generation.py src/pipelines/generation/sql_correction.py src/pipelines/generation/sql_generation_reasoning.py src/pipelines/generation/followup_sql_generation.py src/pipelines/generation/followup_sql_generation_reasoning.py src/web/v1/services/ask.py`; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py tests/pytest/pipelines/generation/test_denodo_query_decomposition.py tests/pytest/services/test_ask_runtime_instructions.py`; `poetry run pytest tests/pytest/services/test_timing_events.py`; `git diff --check`.
  - Not verified: live Denodo / GraphQL Q20 run after this fix.
- 2026-05-19: Fixed Q20 follow-up failure where SQL correction timed out after Denodo rejected `dm_ord_month_city.ptstart`.
  - Root cause: the first Q20 fix selected the right models and removed `LAG`, but generation copied partition predicates onto `dm_ord_month_city`, whose schema only has `order_year_month` for month filtering.
  - Changed AI prompts/rules to treat `ptstart` and `ptend` as view-specific and to use `order_year_month` for `dm_ord_month_city` unless that exact view schema lists partition fields.
  - Added UI Denodo guard rewrite `removeUnavailableDenodoPartitionFilters`, which uses the manifest to remove unavailable `ptstart`/`ptend` predicates from direct VQL before Denodo MCP validation, avoiding a 60s SQL correction wait for this fixed schema error.
  - Verification: `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py src/pipelines/generation/denodo_subquery_generation.py src/pipelines/generation/sql_generation.py src/pipelines/generation/followup_sql_generation.py src/pipelines/generation/sql_generation_reasoning.py src/pipelines/generation/followup_sql_generation_reasoning.py src/pipelines/generation/sql_correction.py`; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`; `cd wren-ui && yarn test src/apollo/server/utils/tests/denodoMcp.test.ts src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`; `cd wren-ui && yarn check-types`; `git diff --check`.
  - Not verified: live Denodo / GraphQL Q20 run after this fix.
- 2026-05-19: Fixed latest Q20 prompt failure where Denodo rejected raw arithmetic on a `YYYYMM` string.
  - Root cause: after restart, Q20 selected the correct models and avoided `LAG`, but generated `order_year_month >= (SELECT MAX(order_year_month) FROM dm_ord_month_city) - 12`; Denodo reported invalid `subtract` parameter types because `order_year_month` is a YYYYMM string.
  - Changed AI prompts/rules for Denodo decomposition, subquery generation, SQL reasoning, final generation, follow-up generation, and correction to forbid raw arithmetic on YYYYMM fields or `MAX(yyyymm)` subqueries.
  - Required pattern: use concrete YYYYMM lower/upper bounds from normalized question/current time for fixed relative windows, or derive integer `month_index` before dynamic month arithmetic.
  - Verification: `poetry run python -m py_compile src/pipelines/generation/denodo_prompt_context.py src/pipelines/generation/sql_generation.py src/pipelines/generation/followup_sql_generation.py src/pipelines/generation/sql_generation_reasoning.py src/pipelines/generation/followup_sql_generation_reasoning.py src/pipelines/generation/denodo_subquery_generation.py src/pipelines/generation/denodo_query_decomposition.py src/pipelines/generation/sql_correction.py`; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_prompt_context.py`; `poetry run pytest tests/pytest/pipelines/generation/test_denodo_query_decomposition.py`; `git diff --check`.
  - Not verified: live Denodo / GraphQL Q20 rerun after this prompt fix.
- 2026-05-20: Added dedicated Codex task agent `7. 外部调研` for external project research and developer handoff docs.
  - Verification: memory-only update; no business code or tests changed.
- 2026-05-20: Opened `7. 外部调研`, read startup memory plus git branch/status, and recorded that the first assignment lacks a concrete research target.
  - Verification: memory-only update; no business code or tests changed.
- 2026-05-20: Completed MetricFlow semantic-layer external research.
  - Source: `dbt-labs/metricflow` commit `4a36655ee67495b2b3fd71133b1d2119f58d5d22`, official dbt docs accessed 2026-05-20.
  - Output: `docs/research/20260520-metricflow-semantic-layer.md`.
  - Key handoff: MetricFlow builds a typed `SemanticManifest`, validates/transforms it, creates semantic graph lookups from models/entities/dimensions/measures/metrics, and compiles query specs into dataflow plans and SQL. Use as architecture reference for WrenAI Denodo/MDL typed manifest and pre-LLM semantic routing.
  - Verification: source/docs inspected only; no MetricFlow runtime tests executed.

## Parking Lot

- Add a reusable external research doc template under `docs/research/` after the first real assignment.
- Add explicit agent owner labels to future task entries when known.
- Add lightweight templates for benchmark result notes.
- Add examples for SQL correction trace summaries.
- Add a handoff checklist for PR reviews and CI failures.
