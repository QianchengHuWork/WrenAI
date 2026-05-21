# AI Context

Last updated: 2026-05-20 17:32 CST

Long-term technical context for WrenAI AI agents. Keep this file stable and deduplicated.

## Product Focus

- WrenAI is a GenBI system for turning natural language into SQL, charts, and analytics workflows.
- Core loop: user question -> semantic context retrieval -> text-to-SQL generation -> validation/correction -> result/chart.
- Current local emphasis: ChatBI quality, Denodo semantic layer, RAG retrieval, reasoning latency, and agent-assisted debugging.

## Architecture

- `wren-ui/`: Next.js 14 frontend plus Apollo GraphQL server in API routes.
- `wren-ai-service/`: FastAPI service with pipeline-based RAG, generation, and validation orchestration.
- `wren-engine/`: SQL validation/execution engine submodule.
- `ibis-server`: SQL abstraction/data-source layer used by UI/backend flows.
- `qdrant`: vector store for MDL, schema, historical questions, SQL pairs, and semantic examples.
- `wren-mdl/mdl.schema.json`: semantic layer schema.

Service flow:

```text
User -> Wren UI / Apollo -> AI Service -> Wren Engine / Ibis
                         -> Qdrant
                         -> LLM provider
```

## Key Code Areas

- UI GraphQL resolvers: `wren-ui/src/apollo/server/resolvers/`
- UI services: `wren-ui/src/apollo/server/services/`
- UI external adaptors: `wren-ui/src/apollo/server/adaptors/`
- AI pipelines: `wren-ai-service/src/pipelines/`
- AI web services: `wren-ai-service/src/web/v1/services/`
- AI routers: `wren-ai-service/src/web/v1/routers/`
- AI service wiring: `wren-ai-service/src/globals.py`
- AI config: `wren-ai-service/src/config.py`

## Text-To-SQL Pipeline

- Intent classification decides whether a user question should route to SQL generation, charting, explanation, or another path.
- Retrieval should narrow schema/model context before generation.
- SQL generation must respect MDL semantics, selected data-source dialect, and validation feedback.
- SQL correction retries are bounded by `max_sql_correction_retries`.
- Historical questions and SQL pairs are useful RAG examples but should not override current MDL constraints.
- Orchestration boundary: Hamilton pipelines execute per-pipeline DAG steps such as embedding, retrieval, prompt construction, LLM calls, and post-processing. AskService/service orchestration owns chain-level routing such as branching on intent into Text-to-SQL, data assistance, user guide, or misleading-query paths.
- For Denodo ChatBI, SQL quality has two layers:
  - SQL rule layer: Denodo dialect rules, validate API, and SQL Guard for executable SQL.
  - business metric layer: scoped metric-calculation configuration injected into prompts; this depends on customer business-department confirmation because the same metric name may have different formulas across companies, departments, or teams.

## Denodo Semantic Layer

- Denodo path should avoid asking the LLM to infer business meaning directly from raw view names.
- Preferred approach:
  - select relevant Denodo views first
  - convert raw schema to Wren models
  - identify business-critical flags/enums/status fields
  - build business dictionary mappings
  - route questions to likely models before SQL generation
  - validate generated SQL against Denodo/VQL constraints
- PoC semantic modeling/consumption framing:
  - initial modeling: select views by business/metric domain, convert raw schema into business models, capture per-domain metric calculation rules, identify view relationships, then add business dictionaries for flags/enums/status fields.
  - runtime consumption: use embedding retrieval to shortlist candidate views/models, let the LLM select the best business domain from top candidates, normalize business phrases under the current scope, perform SQL planning with prior context and scoped metric rules, generate SQL, then apply Denodo rule/validation guardrails.
- Chinese business note: Denodo 路径的核心是先建立最小可用业务语义，再让模型基于语义生成和校验 SQL，减少业务口语与底层字段值的错位。

## Denodo VQL Generation Facts

- As of 2026-05-15 15:00 CST, direct Denodo VQL mode is implemented in the current dirty worktree:
  - AI service Denodo generation, follow-up generation, subquery generation, and correction switch to Denodo VQL prompts when Denodo context is present.
  - Denodo post-processing extracts VQL text without AI-service Wren-engine dry-run validation; final executability is delegated to UI Denodo MCP validation.
  - AI service `AskResult` can return `sql_dialect: DIALECT` for newly generated Denodo VQL.
  - UI Denodo prompt augmentation includes compact native Denodo view/column mapping so the LLM can emit native view names and native column names directly.
  - UI `DenodoSqlGuardService` skips `toDenodoNativeSql` for `DIALECT` candidates, then still runs semantic dictionary rewrite, DENSE_RANK rewrite, Denodo MCP validation, and optional AI-service correction.
  - Direct `DIALECT` candidates still pass through a narrow expression-only sanitizer before Denodo MCP validation. It does not remap native table/column names, but it normalizes Denodo-sensitive expressions such as `TO_NUMBER(x)` to `CAST(x AS DECIMAL(18, 2))`, Denodo date bucket functions, cast targets, and parser-emitted null limits.
  - Non-`DIALECT` candidates still use `toDenodoNativeSql` as a legacy fallback for historical SQL pairs/views/old results.
- Denodo prompts should not use `TO_NUMBER`; numeric text conversion inside aggregates should prefer `CAST(<expression> AS DECIMAL(18, 2))`. This was added after Denodo rejected `AVG(TO_NUMBER(package_price)) AS avg_price_increase` for a package-price uplift query.
- Denodo prompts should avoid unnecessary CTEs for simple single-view aggregation. In particular, do not add a CTE only to compute a casted field, rename fields, or filter one table; inline `CAST` inside `SUM`/`AVG` instead. Use CTEs only when needed for mixed grains, top-N per group, or multi-step joins.
- UI Denodo guard treats MCP validation tool exceptions as invalid SQL attempts and routes them through the existing correction loop. This was added after a CTE-style package aggregation surfaced `Cannot read properties of null (reading 'id')` during validate.
- Denodo scope normalization must preserve the full Denodo semantic context marker and native VQL schema context. If selected-model scoping narrows dictionary entries, replace only the `Semantic dictionary entries:` section; do not replace the entire semantic context with the scoped dictionary summary. Losing `[[WREN_DENODO_CONTEXT]]` makes AI service SQL generation/correction fall back to generic Wren-engine dry-run, which can surface misleading errors like `Cannot read properties of null (reading 'id')` even when the SQL is executable in Denodo.
- Previous SQL-first behavior caused CTE aliases, derived table aliases, and generated alias references to fail VQL rules because they were outside manifest-backed table/column mapping. Direct VQL mode is intended to reduce that failure class, but live benchmark impact is not verified yet.
- Local Denodo AI SDK assessment: the SDK contains useful VQL prompts/rules/fixers (`query_to_vql.py`, `vql_rules/*`, `prepare_vql`, `vql_fixer.py`), but no clean low-level VQL-only generation/fixer API. `answerQuestionUsingViews` still runs a full question-answering flow.
- Denodo skills package assessment: `/Users/qianchenghu/Downloads/denodo-skills-public-main.zip` is useful prompt/reference material for VQL rules, not executable integration code.

## Denodo Complex Query Decomposition

- As of 2026-05-15 16:35 CST, AI service has a Denodo-only complex-query decomposition path in code:
  - `enable_denodo_query_decomposition` default `True`
  - `enable_denodo_parallel_subquery_generation` default `True`
  - `denodo_query_decomposition_max_subqueries` default `3`
- The path runs after schema retrieval / Denodo scope resolution / query normalization and before `sql_generation_reasoning`.
- For Denodo complex questions, the service asks an LLM for structured decomposition, generates 2-3 CTE-compatible internal VQL subquery drafts in parallel, and injects those drafts into final VQL generation/correction as guidance.
- `sql_generation_reasoning` and follow-up reasoning receive hidden non-SQL decomposition context so the reasoning step itself can organize around the subtask plan.
- Subquery drafts are intentionally described as internal VQL drafts, not standalone validated SQL. The final single VQL query must still pass UI-side Denodo MCP validation.
- User-facing contract remains one final SQL. Intermediate subquery SQL/results are not exposed through UI or GraphQL.
- UI GraphQL exposes only a lightweight `queryDecomposition` summary for planning display: `complexity`, `subqueryCount`, and each subquery's `cteName`, `objective`, and `grain`.
- The `Organizing` UI shows the decomposition block after selected scope and normalized query; it never shows subquery SQL or validation details.
- Any decomposition, subquery generation, subquery validation, or context-build failure falls back to the legacy single-SQL generation path.
- Timing events added for analysis: `ai.denodo_query_decomposition`, `ai.denodo_subquery_generation_attempt`, and `ai.denodo_subquery_generation_parallel`.

## Denodo Ask Timing And SQL Trace

- For ask-stage performance comparison, use `wren-ui/.tmp/ask-timing.jsonl` as the source of truth. Do not mix in answer-summary timing unless explicitly evaluating answer generation.
- Benchmark runs that need full step traces should call UI GraphQL `createAskingTask` and poll `askingTask`, not only call the direct AI `generate_sql` path.
- SQL body/debug traces are separate from timing:
  - raw SQL events: `wren-ui/.tmp/ask-sql-trace.jsonl`
  - folded Markdown report: `scripts/ask-sql-trace-markdown.mjs`
  - readable timing JSONL: `scripts/ask-timing-readable-jsonl.mjs`
- `ask-sql-trace.jsonl` can store full SQL for debugging; keep `ask-timing.jsonl` focused on compact performance facts.

## RAG Notes

- Retrieval quality depends on concise MDL descriptions, model/column naming, relationships, and curated examples.
- High-value indexed artifacts:
  - selected models and columns
  - model relationships
  - metrics and calculated fields
  - business dictionaries for flags/enums
  - verified SQL pairs
  - known anti-examples or correction traces
- Avoid flooding retrieval with entire raw schemas when a scoped semantic layer is available.

## External Research References

- MetricFlow semantic-layer research: `docs/research/20260520-metricflow-semantic-layer.md`
  - Source: `dbt-labs/metricflow` at `4a36655ee67495b2b3fd71133b1d2119f58d5d22`, accessed 2026-05-20.
  - Durable pattern: build a typed semantic manifest first, then derive a semantic graph from models/entities/dimensions/measures/metrics before query planning.
  - WrenAI implication: Denodo selected views should move toward a typed manifest with entities, dimensions, measures, metrics, and join constraints; use graph validation/routing before LLM SQL/VQL generation.
  - Caveat: MetricFlow is metric-centric and dbt-artifact-centric, so it is an architecture reference rather than a drop-in dependency.

## Semantic Routing Experiments

Candidate routing dimensions:

- domain/model selection: order, payment, refund, delivery, conversion, city aggregation
- task type: SQL answer, chart, explanation, data modeling, troubleshooting
- confidence: direct answer, ask clarification, fallback to broader retrieval
- tool path: local MDL, Denodo metadata, Qdrant retrieval, MCP metadata, engine validation

Track experiment status in `/ai/ACTIVE_STATE.md`; promote durable conclusions to `/ai/DECISIONS.md`.

## MCP Integration Ideas

- Schema MCP: expose selected Denodo views, MDL models, columns, relationships, and dictionaries.
- Trace MCP: search ask-task timing traces, SQL correction attempts, retrieval payloads.
- Docs MCP: expose deployment/runbook snippets and local troubleshooting notes.
- Evaluation MCP: run benchmark question sets and return pass/fail plus generated SQL.

## Deployment

- Full local stack: `docker/` with `.env.local` and `config.yaml`.
- Source development stack:
  - start `wren-engine`, `ibis-server`, `qdrant` from `wren-ai-service/tools/dev/docker-compose-dev.yaml`
  - run `wren-ai-service` locally on `:5556`
  - run `wren-ui` locally on `:3000`
- Source startup details live in `docs/source-startup.zh-CN.md`.
- AI service startup reads remote docs from `config.doc_endpoint`; when parsing `llms.md`-style payloads, preserve multiline content and split only on the first newline per entry. A naive `split("\n")` can fail if the doc body itself contains line breaks.

## Customer Denodo POC Deployment Notes

- Customer POC root discussed in this session: `/data/wenai/poc`.
- Customer service directories:
  - `/data/wenai/poc/wren-ai-service`
  - `/data/wenai/poc/wren-ui`
- Customer UI was described as started with `nohup yarn dev -p 3400`.
- In that startup mode, trace files are expected under the UI working directory, e.g. `/data/wenai/poc/wren-ui/.tmp/ask-timing.jsonl` and `/data/wenai/poc/wren-ui/.tmp/ask-sql-trace.jsonl`.
- Customer environment may not have `rsync`; prefer manual backup plus file-by-file overwrite unless site tooling is confirmed.
- Do not auto-overwrite customer config files. Treat `docker/customer-x86/config.customer.yaml` as a config candidate/diff source because customer secrets and local endpoints may differ.

## Operational Tooling

- `scripts/denodo-vql-benchmark.mjs` is the current repo-level benchmark entrypoint for local UI runs. It supports:
  - `asking_task` mode via `POST /api/graphql`
  - `generate_sql` mode via `POST /api/v1/generate_sql`
  - JSON question inputs such as `scripts/denodo-vql-benchmark-questions.customer.json`
- `scripts/ask-timing-readable-jsonl.mjs` converts `wren-ui/.tmp/ask-timing.jsonl` into a readable JSONL report and can optionally map questions to ids from a JSON question file.
- Ask timing traces are written from the UI side into `wren-ui/.tmp/ask-timing.jsonl` via `src/apollo/server/utils/timingTrace.ts` and the ask-task/answer trackers.
- SQL trial/debug traces are written to `wren-ui/.tmp/ask-sql-trace.jsonl` when the current trace changes are active; use `scripts/ask-sql-trace-markdown.mjs` to generate a human-readable report.

## Constraints

- Preserve existing user/agent modifications unless explicitly asked to revert.
- Keep memory files high signal; do not paste long logs.
- Do not treat generated SQL as correct until dialect and engine validation pass.
- Denodo/VQL compatibility must be checked separately from generic SQL validity.
- Keep root service conventions from `/AGENTS.md` authoritative for build/test commands.

## Known Issue Themes

- Large schema context can dilute retrieval and increase wrong-table risk.
- Business status words often require explicit dictionary mapping.
- Cross-model relationships are useful but less mature than selected-view and field-level semantics.
- Latency needs tracing across UI GraphQL, AI service, retrieval, LLM, engine validation, and correction.
- Denodo benchmark failures can come from model/schema drift; in this session several hard questions generated SQL against missing view `dv_clew_ord_conversion_core_new`, which needs semantic-layer or environment confirmation before treating generated SQL as valid.
