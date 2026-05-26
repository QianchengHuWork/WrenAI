# Active State

Last updated: 2026-05-25 15:12 CST

Keep this file short. It should describe the current working state, not the full history.

## Branch Status

- Branch: `codex/denodo-selected-views-followup`
- `/ai` memory system: initialized.
- Root `AGENTS.md` and `.claude/CLAUDE.md` now point agents to `/ai` startup files.
- Current dirty worktree / local session files to preserve:
  - `AGENTS.md`
  - `.claude/CLAUDE.md`
  - `wren-ai-service/src/utils.py`
  - `wren-ai-service/src/web/v1/services/ask.py`
  - `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
  - `wren-ui/src/apollo/server/models/adaptor.ts`
  - `wren-ui/src/apollo/server/services/askingTaskTracker.ts`
  - `wren-ui/src/apollo/server/services/denodoSqlGuardService.ts`
  - `wren-ui/src/apollo/server/services/tests/denodoSqlGuardService.test.ts`
  - `wren-ui/src/apollo/server/utils/timingTrace.ts`
  - `scripts/ask-sql-trace-markdown.mjs`
  - `scripts/ask-timing-readable-jsonl.mjs`
  - `scripts/denodo-vql-benchmark-questions.customer.json`
  - `ai/` (untracked shared memory directory)

## Current Focus

- Persistent multi-agent memory under `/ai` is initialized.
- Preserve active Denodo/timing-trace work without modifying unrelated service files.
- Keep future agents oriented around ChatBI, RAG, text-to-SQL, Denodo semantic layer, MCP, and semantic routing.
- Current thread focus: memory backfill for the current chat plus source-dev / benchmark script verification. This memory-backfill turn does not change business code; the broader chat did include Denodo/timing/trace code work recorded below.
- Branch-management backfill also records this chat's customer-stable branch handoff; no business code changes were made for that backfill.
- Current Denodo focus from this chat: direct Denodo VQL generation is implemented in the current dirty worktree, but live Denodo benchmark/runtime behavior is not verified yet.
- Current Denodo metric formula rule from this chat: AI-service prompts, default formula seeds, runtime `metric-formulas.json`, and the hidden full-lead exemplar no longer add rate/amount `CAST` expressions by default. Generation should preserve the formula expression shape, usually `COUNT(...) * 100.0 / NULLIF(...)`; UI Denodo native SQL / direct DIALECT sanitizer may still normalize already-generated `TO_NUMBER` or `FLOAT`/`DOUBLE` casts before MCP validation.
- Latest line-clue-overview formula fix: for dimensioned lead conversion questions such as "1月不同等级的线索，各自的转化率和产出金额", the formula now explicitly requires the lead CTE to preserve `niche_id + display dimensions` before joining orders. This prevents SQL like `leads_per_level GROUP BY clew_level` followed by `l.niche_id`, which Denodo rejects as `Field not found 'l.niche_id'`.
- Current Denodo scope-selection update: the current task explicitly rolled the worktree back to clean `55c98fd5` before new edits. Scope selection is now model-led again: retrieved Denodo documents keep their original order, `_override_denodo_scope_for_known_patterns(...)` no longer rewrites `selectedModels`, and metric formulas are supplied to the scope-resolution prompt only as optional business hints. SQL-generation metric formulas are injected only after selected-model narrowing, so formulas cannot pull `dv_assign_total_conversion_core` into ordinary full-order questions before the model chooses scope.
- Latest Denodo benchmark observation from the chat: 22 questions, 3 rewrites, average latency around 4.5 minutes; main cost appeared to be planning/generation, not only validate/correction.
- Current implementation update: Denodo complex-query decomposition now runs after Denodo scope resolution / query normalization and before `sql_generation_reasoning`; reasoning, final generation, and correction all receive hidden decomposition context. The UI now receives only lightweight `queryDecomposition` summaries and shows them in Organizing after selected scope / normalized query. Direct-VQL mode still makes Denodo generation/correction return native VQL with `sql_dialect: DIALECT`; UI guard skips `toDenodoNativeSql` for those candidates and keeps legacy conversion as fallback.
- Latest Denodo direct-VQL bugfix: direct `DIALECT` candidates now run a narrow UI-side expression sanitizer before MCP validation. This keeps native Denodo identifiers untouched but rewrites risky expressions such as `TO_NUMBER(x)` to `CAST(x AS DECIMAL(18, 2))`; AI Denodo prompt rules also now explicitly ban `TO_NUMBER`.
- Follow-up Denodo bugfix: Denodo MCP validate exceptions such as `Cannot read properties of null (reading 'id')` are now treated as invalid SQL and routed through the existing correction loop instead of failing the ask immediately. Denodo prompt rules also discourage unnecessary CTEs for simple single-view aggregations.
- Latest root-cause fix for the same null-id symptom: AI service scope normalization was replacing the full Denodo semantic context with only a scoped dictionary summary, dropping the `[[WREN_DENODO_CONTEXT]]` marker and native VQL schema context. That made SQL generation/correction fall back to generic Wren-engine dry-run. The scoped context builder now preserves Denodo marker/native context and replaces only the dictionary section.
- Superseded Q20 scope note: Q20-specific SQL-shape prompts still forbid `LAG`/`LEAD`, require true intermediate Top-N filtering, and use YYYYMM `month_index` self joins, but code no longer force-overrides scope to `dv_clew_ord_conversion_core` + `dm_ord_month_city`. The scope-resolution model must now choose those views from prompt guidance and candidate metadata.
- Latest Q20 follow-up fix: the post-Q20 run no longer used `LAG` and selected the right models, but Denodo validate failed because generated SQL added `ptstart`/`ptend` to `dm_ord_month_city`, which lacks those columns. AI prompt rules now treat `ptstart`/`ptend` as per-view fields and tell Q20 to filter `dm_ord_month_city` by `order_year_month`. UI Denodo guard now strips unavailable `ptstart`/`ptend` predicates per view from direct VQL using the manifest before validation, preventing this fixed schema error from waiting 60s for correction.
- Latest Q20 trace follow-up: correction timeout `b4bcf135-1117-4b43-b239-2e832ac44f1b` was a new Denodo type error, not the prior partition-field issue. Trace `be0bc5c6-8691-4536-bcb4-7e4c25da6a5d` selected the right models, avoided `LAG`, and had true Top 5 filtering, but generated `order_year_month >= (SELECT MAX(order_year_month) ...) - 12`. Denodo rejected subtracting an integer from a YYYYMM string. AI prompts/rules now forbid raw YYYYMM arithmetic and require concrete YYYYMM bounds or derived `month_index` integer comparisons.
- Latest Denodo partition-rule fix: user confirmed `ptstart` and `ptend` must be equality-only Denodo parameter boundaries, not range predicates. AI service Denodo generation/reasoning/subquery/correction prompts and UI default Denodo SQL instruction now require `ptstart = '<start_yyyymmdd>' AND ptend = '<end_yyyymmdd>'` and explicitly forbid `<`, `<=`, `>`, `>=`, and `BETWEEN` for those fields.
- Latest Denodo smart-assignment metric fix: smart-assignment lead count/order count/conversion rate/converted amount questions now prefer `dv_assign_total_conversion_core` when it is a retrieved candidate. Runtime formula rules use distinct `clew_id`, paid `biz_order_no` with `is_ord_fdpay = 1`, and `actual_price`; the old smart-assignment `converted_order_count / assigned_clew_count` guidance is no longer injected. After a rerun still produced `COUNT(*)` / `is_ord_pay`, the formula was also promoted into Denodo reasoning, subquery generation, final generation, follow-up generation, and correction prompt constraints, explicitly banning `COUNT(*)`, `is_ord_pay`, and `SUM(CASE ... THEN 1 ELSE 0 END)` for these metrics. Verified with system `python3 -m py_compile` and `git diff --check`; focused pytest is pending because this shell lacks `poetry` and `pytest`.
- `7. 外部调研` completed MetricFlow semantic-layer research. Durable doc: `docs/research/20260520-metricflow-semantic-layer.md`; source repo `dbt-labs/metricflow` at `4a36655ee67495b2b3fd71133b1d2119f58d5d22`, accessed 2026-05-20.

## Codex Task Agents

This table tracks Codex-side task agents/threads, not tool brands. Ages are imported from the Codex sidebar screenshot and should be replaced with concrete handoff notes when each agent is opened.

| Codex agent/thread | Last seen | Status | Scope | Current memory |
| --- | --- | --- | --- | --- |
| Current chat - Denodo FLOAT rewrite fix | 2026-05-22 17:04 CST | Done | Denodo UI SQL rewrite / MCP validate preflight. | Removed the legacy `forceFloatForCountRate` path in `wren-ui/src/apollo/server/utils/denodoMcp.ts`, so both `toDenodoNativeSql` and `sanitizeDenodoDialectSql` normalize `FLOAT`/`DOUBLE`/`REAL`/`NUMBER` casts to `DECIMAL(18, 6)` instead of reintroducing `FLOAT`. Added UI tests for legacy and direct DIALECT paths; SQL correction prompt now explicitly fixes `round(double precision, integer)` by using DECIMAL casts. Verified with py_compile, focused AI pytest, focused UI Jest, UI typecheck, and `git diff --check`. |
| Current chat - Denodo metric formula cast cleanup | 2026-05-25 14:47 CST | Done | Denodo prompt / runtime formulas / hidden exemplar. | Removed prompt/default-formula/hidden-exemplar guidance that added `DECIMAL(18, 6)` or `DECIMAL(18, 2)` casts for metric calculations. Runtime formulas and exemplars now preserve direct customer-calibrated expressions, while the UI sanitizer remains a last-mile cleanup for already-generated `TO_NUMBER` or `FLOAT`/`DOUBLE` casts. Verified with py_compile, focused AI pytest, UI typecheck, JSON parse, and `git diff --check`. |
| Current chat - Line-clue dimension grain fix | 2026-05-25 15:12 CST | Done | Runtime metric formula prompt guidance. | Diagnosed correction timeout `e1c40897-03cb-4140-b6b0-fff2ad1bca38`: Denodo validate failed quickly because `leads_per_level` grouped only by `clew_level` and later referenced `l.niche_id`; AI correction finished after the UI 60s wait. Updated default and active line-clue formulas to require `niche_id + display dimensions` in intermediate CTEs and added AI-service prompt-injection test coverage. |
| Current memory backfill session | 2026-05-15 11:05 CST | Done | Shared `/ai` memory backfill for current chat history. | Read `/AGENTS.md`, `/ai/*`, checked `git branch`/`git status`, captured source-dev/runtime notes, customer branch handoff, Denodo AI SDK/skills findings, direct-VQL plan, timing/SQL trace state, and benchmark/model observations. No business code changes were part of this memory task. |
| Add AI memory system | 25 min | Active | Shared `/ai` memory layer. | Created `/ai` files; added root and Claude pointers; correcting `ACTIVE_STATE.md` to track Codex task agents. |
| 6. 测试 | 6 days | Needs handoff | Test strategy and verification. | Details not imported yet. Likely next target: validate Denodo SQL guard/trace changes with focused `wren-ui` tests and E2E ask run. |
| 7. 外部调研 | 2026-05-20 17:32 CST | Done / handoff ready | MetricFlow semantic-layer construction research. | Created `docs/research/20260520-metricflow-semantic-layer.md` from `dbt-labs/metricflow` commit `4a36655ee67495b2b3fd71133b1d2119f58d5d22` plus official dbt docs. Key finding: MetricFlow builds a typed `SemanticManifest`, validates/transforms it, builds semantic/model/entity/metric lookups and a semantic graph, then compiles query specs into dataflow plans and SQL. WrenAI implication: use a typed Denodo/MDL manifest plus graph validation/routing before LLM SQL/VQL generation. Runtime behavior not executed. |
| 2. 拉起项目 专用 | 1 month | Historical/needs refresh | Local source startup. | Related durable doc: `docs/source-startup.zh-CN.md`. Refresh if startup commands/env changed. |
| 3. 项目总结和文案 | 2026-05-15 11:02 CST | Done / handoff ready | Resume wording and interview preparation for ChatBI PoC. | Created ignored working docs `.tmp/resume-chatbi-poc.md` and `.tmp/chatbi-poc-review-outline.md`; captured project positioning, Denodo semantic-view governance, semantic layer Manifest, semantic dictionary, Hamilton Pipeline vs AskService orchestration, Denodo SQL rule layer plus business-metric scope layer. No service tests run; docs are ignored by Git. |
| 5. AI SDK 生成 VQL | 2026-05-15 15:00 CST | Implemented / benchmark pending | AI SDK/skills assessment, Denodo VQL generation strategy, guard behavior, timing traces, and benchmark tuning. | Completed: assessed local Denodo AI SDK under `/Users/qianchenghu/Documents/工作/极氪/denodo-ai-sdk-public-9-dev`; found useful prompt/rule/fixer references but no clean VQL-only API. Assessed `/Users/qianchenghu/Downloads/denodo-skills-public-main.zip`; found prompt/reference rules only, not executable generator/parser/fixer code. Implemented direct Denodo VQL mode in current dirty worktree: Denodo generation/follow-up/subquery/correction use VQL prompts, skip AI-service Wren-engine validation, return `sql_dialect: DIALECT`; UI prompt context includes native Denodo view/column mapping; UI guard skips `toDenodoNativeSql` for DIALECT while preserving semantic rewrite, DENSE_RANK rewrite, MCP validate/correction, and legacy fallback. Verified with py_compile, focused AI pytest, UI Jest, UI typecheck, and `git diff --check`; live Denodo benchmark not run. |
| 4. 分支管理 | 2026-05-15 11:02 CST | Done / Historical | Customer stable branch handoff and branch hygiene. | This chat created and pushed `codex/customer-stable-20260507` at `f4519dec`, fast-forwarded `origin/main` to that commit, then created and pushed `codex/customer-stable-20260513` at `b1c966c4` and deleted old `0507` remote/local branches. Current branch remains `codex/denodo-selected-views-followup`. No CI/app tests were run for the branch operations. The untracked timing benchmark scripts were not included in the customer branch at that handoff. |
| 分析提问失败原因 | 2026-05-15 11:05 CST | In progress | Diagnose ask failures, trace generation/correction/validation, and explain latency. | Current dirty files add SQL trace events in AI service/UI and scripts for readable trace output. Focused verification exists for py_compile, script syntax, UI types, targeted guard test, and targeted lint; full UI lint/customer runtime remain unverified. Chat analysis found that a validated MCP attempt can still appear slow if later guard/correction/polling or summary steps keep running; detailed traces should use `.tmp/ask-timing.jsonl` and `.tmp/ask-sql-trace.jsonl`. |
| 当前聊天 - Denodo benchmark/customer trace | 2026-05-15 11:04 CST | Active/In progress | Denodo VQL enhancements, ask timing, SQL trace, benchmark automation, customer manual migration handoff. | See "Current Session Handoff" below. |

## Current Session Handoff

- Session/thread: current Codex chat for Denodo benchmark, customer SCP handoff, and SQL trace debugging.
- Status: Active/In progress. Memory backfill requested; latest functional request before memory backfill was to simplify SQL trace Markdown by removing duplicates and keeping only each attempt.
- Completed:
  - Expanded local Denodo benchmark questions to 20 in `.tmp/denodo-benchmark-questions.json` during the session; first 10 are base cases and q11-q20 are harder multi-metric/share/top-N/cross-group/MoM/consecutive-decline cases.
  - Updated benchmark direction to use GraphQL asking-task polling so `ask-timing.jsonl` can be aligned with `taskId`, `queryId`, `traceId`, status, models, and tool calls.
  - Added/used customer-facing 10-question benchmark file `scripts/denodo-vql-benchmark-questions.customer.json`.
  - Added readable timing output script `scripts/ask-timing-readable-jsonl.mjs`.
  - Added SQL trace plumbing across AI service and UI: AI service returns `sql_trace_events`; UI maps `sqlTraceEvents`; UI writes `wren-ui/.tmp/ask-sql-trace.jsonl`.
  - Added `scripts/ask-sql-trace-markdown.mjs` to generate folded Markdown SQL reports from trace JSONL.
  - Prepared customer manual deployment guidance for `/data/wenai/poc`, including core source files, scripts, config candidate handling, backup/rollback concepts, and no blind config overwrite.
  - Helped user manually copy core files into customer environment; user confirmed key markers existed after copy (`DENODO_CONTEXT_MARKER`, `TIMING_TRACE_PATH`) and no target files were missing.
  - Ran a local 20-question benchmark on 2026-05-13 from `2026-05-13T12:55:02Z`; wall-clock about 82 minutes.
- 20-question benchmark result:
  - Output: `/tmp/denodo-vql-benchmark-20260513T125502Z.json`
  - Readable timing JSONL: `/tmp/ask-timing-readable-2026-05-13T12-55-02Z.jsonl`
  - SQL trace filtered JSONL: `/tmp/ask-sql-trace-filtered-2026-05-13T12-55-02Z.jsonl`
  - SQL trace Markdown: `/tmp/ask-sql-trace-2026-05-13T12-55-02Z.md`
  - Total 20, success 16, failed 4.
  - Successful median about 161s, average about 164s, trimmed average about 163s.
  - Failed q12/q17/q19 generated or corrected SQL against missing view `dv_clew_ord_conversion_core_new`.
  - Failed q20 had `fetch failed`; no matching `ask_finished` record was found, and local `localhost:3000` was no longer listening afterward.
- Verified in this session:
  - `python -m py_compile wren-ai-service/src/web/v1/services/ask.py`
  - `node --check scripts/ask-sql-trace-markdown.mjs`
  - `cd wren-ui && yarn check-types`
  - `cd wren-ui && yarn test src/apollo/server/services/tests/denodoSqlGuardService.test.ts --runInBand`
  - Targeted `next lint --file ...` for modified UI files.
- Not verified:
  - Full `wren-ui` lint remains known to fail on unrelated pre-existing files.
  - Customer runtime behavior after manual file replacement is not verified from this workspace.
  - Latest requested Markdown de-duplication/attempt-only cleanup has not been implemented yet.
  - Root cause for customer-side `clarification needed / no relevant SQL` after changing a 30000ms timeout is not confirmed.
- Next handoff:
  - Implement SQL trace Markdown de-duplication so the report groups by ask/question and shows only each distinct attempt.
  - Investigate why hard questions choose `dv_clew_ord_conversion_core_new` when that view is unavailable.
  - Re-run q20 or the 10-question customer set with a stable UI process before using q20 performance as signal.
  - For customer deployment, assume manual file transfer and backup, not `rsync`.

## External Assistant Tool Status

- Claude/Gemini/Cursor/ChatGPT/Copilot are supported by protocol, but this file should primarily track Codex task agents unless a non-Codex tool directly changes the repo.

## Active Experiments

- Denodo selected-view follow-up work appears active based on branch name and modified files.
- Ask timing/tracing appears active based on `askingTaskTracker`, `timingTrace`, and trace scripts.
- Denodo SQL guard benchmarking appears active based on modified guard service/tests and benchmark questions.
- Direct Denodo VQL generation is implemented in the dirty worktree and now needs runtime benchmarking; legacy SQL-to-VQL conversion remains as fallback for non-`DIALECT` candidates.
- SQL trace Markdown readability is the next requested improvement: remove duplicate SQL entries and keep meaningful per-attempt blocks.
- Denodo complex-query decomposition and direct-VQL mode both need runtime benchmarking on customer-style questions; code-level checks passed after the decomposition-order/UI-summary change, but no live Denodo benchmark has been run after these changes.
- Direct-VQL expression sanitization, validate-exception correction, and scoped Denodo context preservation have focused test coverage, but no live customer Denodo execution has been run after these fixes.
- Q20 consecutive-decline prompt/scope fix has focused AI service coverage, but still needs a live GraphQL asking-task rerun against Denodo to confirm `status=FINISHED`, no `Function lag is not executable`, and selectedModels/final SQL table consistency.
- Q20 rerun after the first fix failed with `Field not found 'dm_ord_month_city.ptstart'` and correction timeout `37f4fb9e-5879-48fc-82fd-a8c85d897ca6`; focused AI/UI tests now cover the partition-field fix, but a live GraphQL Q20 rerun is still needed.
- The latest Q20 rerun failed on invalid YYYYMM arithmetic with correction timeout `b4bcf135-1117-4b43-b239-2e832ac44f1b`; prompt-level fix is in place, but a live rerun is still needed to confirm the model emits concrete `202506`..`202605`-style month bounds or safe `month_index` filters.
- Future Denodo live reruns should also verify that generated VQL uses equality for `ptstart`/`ptend`; range operators on those fields are now considered invalid semantics even if Denodo accepts the syntax.
- Future smart-assignment live reruns should verify that questions like "统计上个月智能分配线索数、订单数、转化率和转化订单金额" select `dv_assign_total_conversion_core`, use `COUNT(DISTINCT "clew_id")`, `is_ord_fdpay = 1`, distinct paid `biz_order_no`, `actual_price`, and equality-only `ptstart`/`ptend`.
- File-backed metric formulas are now being added as a knowledge type: UI server persists `metric-formulas.json`, the Knowledge page edits it through REST, Ask reads enabled formulas per request, and AI service injects matching Denodo formulas as runtime prompt instructions.
- The default metric-formula layer now includes `denodo_clew_overview_conversion` for line-clue-overview / full-lead conversion analysis using `dv_clew_core` plus `dv_ord_core` and niche-level attribution.
- The default metric-formula layer now also includes `denodo_niche_drive_conversion` for smart-assignment test-drive conversion using `admin.dv_niche_ord_conversion_core` / `dv_niche_ord_conversion_core`.
- The default metric-formula layer now includes `denodo_package_order_metrics` for option-package popularity and package-price uplift using `dv_package_order_core`, `package_name`, distinct `biz_order_no`, and `package_price`.
- The `denodo_clew_overview_conversion` formula now requires lead attribution via conditional aggregation: start from `leads_per_niche`, keep `min_clew_date`, and put the order-date attribution predicate inside each order count/rate/amount `CASE WHEN`, e.g. `COUNT(DISTINCT CASE WHEN has_ord_fdpay = 1 AND order_date >= min_clew_date THEN niche_id END)`. Do not model it as "pre-WHERE then join" or as a join-only predicate.
- Denodo rounded rate/percentage prompts now preserve the runtime formula shape instead of requiring `DECIMAL(18, 6)` casts. UI sanitizer still prevents already-generated `FLOAT`/`DOUBLE` casts from reaching Denodo MCP validation.
- The line-clue-overview formula also forbids `paid_flag` for refund-included conversion and tells the model to use `LEFT JOIN dv_ord_core` from `leads_per_niche`, not an `INNER JOIN`, so no-order leads remain in the denominator.
- A hidden AI-service-only Denodo SQL exemplar now covers the full-lead large-deposit conversion/refund-comparison test question. It matches same-semantics/month-variant questions, injects only into final SQL generation/follow-up generation/correction, and is intentionally not passed into SQL-generation reasoning or UI-visible decomposition/reasoning. The template uses the user-provided `leads_per_niche` + `orders_per_niche` shape with no added metric casts: lead window uses compact date keys, `orders_per_niche` filters `order_date_key >= l.min_clue_date`, amounts use `gross_order_amount`, and the final summary `LEFT JOIN`s `orders_per_niche`.
- Latest metric-formula precedence fix: when a file-backed Denodo metric formula matches the selected/retrieved scope, AI service now treats that formula as the source of truth and skips the built-in business-formula fallback. Static Denodo reasoning/generation/correction prompt blocks no longer restate the old smart-assignment formula; they defer to runtime metric formulas.
- Latest scope-routing fix: non-smart-assignment lead-source and lead-overview conversion questions, including "线索四级来源目录 + 线索量 + 订单转化率" and "全量线索大定支付转化率 / 含退订 / 不含退订", now prioritize and override to `dv_clew_core` plus `dv_ord_core` when both candidates are available, instead of selecting `dv_assign_total_conversion_core`.
- Latest prompt patch: scope resolution prompt now explicitly tells the LLM to select `dv_clew_core` + `dv_ord_core` for general all-leads/full-lead/lead-overview/lead-source/fourth-level-source conversion questions and to avoid `dv_assign_total_conversion_core.channel_id` or `assign_year_month` unless the user explicitly asks for smart assignment.
- Latest retrieval-scope change: AI service table retrieval candidate count is now 10 by default and local ignored `wren-ai-service/config.yaml` is also set to `table_retrieval_size: 10`, so scope resolution can see more candidate models after restart.

## Debugging Notes

- No commands/tests have been run for service behavior during memory initialization.
- Current observation only: worktree is dirty before memory files were added.
- Memory verification: `/ai` file presence checked; tracked-file whitespace check passed.
- Current progress review read key diffs only; no service behavior tests run.
- Agent-level correction: previous `Agent Progress Snapshot` used tool brands; active state now tracks Codex task agents/threads.
- This thread verified by inspection only:
  - `git check-ignore -v .tmp/resume-chatbi-poc.md`
  - `git check-ignore -v .tmp/chatbi-poc-review-outline.md`
  - relevant source reads for intent classification and AskService routing.
- Not verified in this thread: no `wren-ui` or `wren-ai-service` tests/builds were run for business behavior.
- Source-dev runtime was rechecked during this session: `wren-ui` on `:3000` and `wren-ai-service` on `:5556` after restarting the local source processes.
- Branch-management memory backfill verified git branch/ref state only; no application behavior was re-tested in this turn.
- Denodo AI SDK finding: useful files include `api/prompts/vql_generation/query_to_vql.py`, `api/prompts/vql_rules/*`, `api/utils/sdk_utils.py` (`prepare_vql`), `api/utils/ai_tools/vql_fixer.py`, and `api/utils/answer_question/sql_flow.py`, but they are embedded in a full SDK flow rather than exposed as a small VQL-generation contract.
- Denodo skills zip finding: useful VQL rules include double-quoted columns/aliases, protected aliases, `HAVING` restrictions, subquery `LIMIT/FETCH` caveats, `NULLS LAST` invalidity, aggregate `ORDER BY` aliasing, and Denodo date-function guidance. It does not provide executable integration code.
- Current VQL-generation root cause: AI service still generates SQL with Denodo instructions via `build_denodo_runtime_instructions`; UI then runs `toDenodoNativeSql`, semantic rewrites, Denodo MCP validation, and optional AI correction. CTE/derived aliases can still be non-VQL because they are outside manifest mapping.
- Current model config from chat: `default` and `fast` were switched to `openai/Qwen/Qwen3.5-397B-A17B`; `default` has `enable_thinking: true` with `thinking_budget: 4096`, `fast` has `enable_thinking: false`, and `fallback` remains `openai/deepseek-ai/DeepSeek-V3`.
- Benchmark correction nuance: benchmark-level `correctionAttempts` counted UI/Denodo guard tool calls and was 0 for the 20-question run, but SQL trace showed AI-service internal `ai_sql_correction_generated` attempts for some failed cases.
- Answer generation is not needed for the current performance comparison; user explicitly decided ask-stage timing is enough.

## Immediate Next Actions

- Run a focused Denodo benchmark for direct-VQL plus pre-reasoning complex-query decomposition, especially mixed-grain questions such as vehicle-series order ranking plus hottest exterior color and package top-N plus average price uplift.
- Use `docs/research/20260520-metricflow-semantic-layer.md` when designing Denodo/MDL typed manifest, semantic-graph routing, metric definitions, and pre-generation validation.
- Implement the SQL trace Markdown cleanup requested immediately before this memory backfill: de-duplicate repeated SQL and keep per-attempt blocks.
- Inspect `.tmp/ask-timing.jsonl` and `.tmp/ask-sql-trace.jsonl` after the next benchmark to confirm `denodo.to_native_sql` metadata shows `alreadyDialectSql: true`, validate attempts decrease, and generated SQL is native VQL.
- Use `ask-timing.jsonl` as the only source for ask-stage performance comparisons unless the user explicitly asks for answer timing.
- Re-check customer/local UI process health before long benchmark runs; q20 previously failed with `fetch failed` after UI stopped listening.
- Open remaining Codex task agents (`6. 测试`, `2. 拉起项目 专用`) and replace `needs import` rows with concrete file/progress/verification notes.
- If the `20260513` customer stable branch should also become `main`, confirm and fast-forward `origin/main` explicitly; remembered work only pushed `20260507` to `main`.
- After future implementation work, update this file with exact branch, task, verification, and blockers.
- For resume/interview prep: continue expanding `.tmp/chatbi-poc-review-outline.md` from outline into answer scripts if needed; keep it ignored unless the user asks to publish it.
- For the benchmark flow: use `scripts/denodo-vql-benchmark.mjs` for the 10-question set and `scripts/ask-timing-readable-jsonl.mjs` for trace post-processing.
- Re-test the package top-N plus average price uplift question against live Denodo to confirm the final SQL avoids unnecessary CTEs, uses the package formula shape such as `AVG(package_price)`, and no longer fails ask-stage validation on MCP tool exceptions.
- After the next run, inspect `wren-ui/.tmp/ask-sql-trace.jsonl`; for Denodo direct VQL the AI-service trace should show `ai_initial_generation_valid`, not `ai_initial_dry_run_failed`.
- Manually verify `/knowledge/metric-formulas` in a running UI, then run a Denodo Ask for a saved smart-assignment formula without restarting AI service to confirm hot-update behavior.
- Manually verify the line-clue-overview question "上个月的全量线索大定支付转化率是多少？..." and the March refund/no-refund question both select `dv_clew_core` plus `dv_ord_core`, then generate conditional order count/rate/amount expressions that include `order_date >= min_clew_date` inside `CASE WHEN`.
- Manually verify the hidden exemplar is not shown in frontend planning/reasoning while the final SQL follows the latest user-provided `orders_per_niche` structure.
- Manually verify smart-assignment test-drive questions select the niche conversion helper view, filter `ai_assign_drive_cnt > 0`, and avoid rebuilding attribution through `mobile_md5 = phone_no_md5`.
- Re-run the user-edited smart-assignment conversion question and confirm the reasoning/output uses the runtime formula shape such as `is_conver_order = 1` and `actual_price`, not the built-in `is_ord_fdpay` fallback or added casts.
- Re-run the option-package Top 3 question and confirm it selects `dv_package_order_core`, groups by `package_name`, uses `COUNT(DISTINCT "biz_order_no")`, and does not use `dv_ord_core.city_name` or `option_amount`.
- Re-run the lead-source Top 5 conversion question and confirm selected models are `dv_clew_core` + `dv_ord_core`; generated SQL should use the actual fourth-level source field from `dv_clew_core`, not `dv_assign_total_conversion_core.channel_id`.
