# Decisions

Last updated: 2026-05-20 17:09 CST

Preserve decisions unless obsolete. If superseded, move to `Archived Decisions` with reason and date.

## Active Decisions

### 2026-05-15 10:28 CST - Use `/ai` as shared AI memory

- Decision: Store long-term multi-agent context in `/ai`.
- Reason: Multiple AI assistants and accounts need a shared state layer independent of chat history.
- Applies to: Codex, Claude, Gemini, Cursor, ChatGPT, Copilot, MCP-enabled agents.
- Consequence: Agents must read `/ai/AGENTS.md`, `/ai/AI_CONTEXT.md`, `/ai/ACTIVE_STATE.md`, and `/ai/DECISIONS.md` before implementation decisions.

### 2026-05-15 10:28 CST - Split stable context from active state

- Decision: Keep stable architecture in `AI_CONTEXT.md`; volatile branch/debug state in `ACTIVE_STATE.md`.
- Reason: Prevent context pollution and avoid mixing durable architecture with temporary debugging notes.
- Consequence: `ACTIVE_STATE.md` may be compacted; `AI_CONTEXT.md` should change only when durable project knowledge changes.

### 2026-05-15 10:28 CST - Append durable history, compact volatile state

- Decision: Append timestamped updates to `CHANGELOG.md` and `DECISIONS.md`; compact `ACTIVE_STATE.md` when stale.
- Reason: Agents need both history and a concise current-state view.
- Consequence: Do not blindly rewrite memory files. Archive obsolete decisions rather than deleting them.

### 2026-05-15 10:28 CST - English primary, Chinese allowed for business notes

- Decision: Use English for technical implementation notes; allow Chinese for business/domain context.
- Reason: Technical consistency plus bilingual collaboration needs.
- Consequence: Keep terminology consistent across languages.

### 2026-05-15 10:28 CST - Denodo work should be semantic-first

- Decision: For Denodo ChatBI, prefer selected views, MDL modeling, dictionaries, routing, and validation over raw-schema prompting.
- Reason: Raw Denodo schemas increase wrong-table and wrong-filter risk.
- Consequence: Capture Denodo dictionary/routing/guard changes in memory when they affect text-to-SQL behavior.

### 2026-05-15 11:04 CST - Keep ask timing and SQL trace separate

- Decision: Keep `ask-timing.jsonl` focused on performance steps and write full SQL/debug details to a separate `ask-sql-trace.jsonl` plus generated Markdown report.
- Reason: Performance comparisons need stable, compact timing data, while SQL debugging needs full generated/corrected/validated SQL without bloating timing logs.
- Consequence: Future benchmark analysis should read `ask-timing.jsonl`; SQL trial/error review should read `ask-sql-trace.jsonl` or the folded Markdown report.

### 2026-05-15 11:04 CST - Use asking-task GraphQL path for Denodo benchmarks

- Decision: Denodo ask benchmarks should use UI GraphQL `createAskingTask` plus `askingTask` polling when timing trace alignment matters.
- Reason: This path preserves UI task IDs, AI query IDs, trace IDs, selected models, tool calls, and `ask-timing.jsonl` records.
- Consequence: Direct `generate_sql` benchmarking may still be useful for narrow AI service tests, but it is not the preferred source for end-to-end ask-stage performance.

### 2026-05-15 11:04 CST - Avoid automatic customer config overwrite

- Decision: For the customer POC environment, ship source/script changes separately from config candidates and require manual config comparison before applying.
- Reason: The customer host is high-risk, lacks some expected tooling such as `rsync`, and may contain private endpoint/secret config.
- Consequence: SCP handoffs should preserve relative source paths, but `docker/customer-x86/config.customer.yaml` should be treated as a candidate, not blindly copied over production config.

### 2026-05-15 11:05 CST - Do not wrap the full Denodo AI SDK as the VQL generator

- Decision: Do not replace the current planning path by calling the full Denodo AI SDK question-answering flow.
- Reason: The local SDK exposes useful VQL prompts, rules, `prepare_vql`, and fixer references, but its public flow still bundles retrieval/category selection/generation/execution/answering rather than a clean VQL-only generation or correction boundary.
- Consequence: Short-term integration should copy or adapt VQL rules/preflight/fixer ideas into the existing Denodo path. A future direct-VQL path should preserve current planning, emit native Denodo VQL, mark the result as dialect SQL, and keep Denodo MCP validation as the final executable check.

### 2026-05-15 14:27 CST - Use hidden Denodo subquery drafts for complex questions

- Decision: For Denodo complex text-to-SQL questions, use hidden structured decomposition plus parallel CTE-compatible subquery draft generation/validation before final SQL generation.
- Reason: Questions that combine different grains, ranking, top-N-per-group, and attributes can be too difficult for a single final-SQL generation pass.
- Consequence: Keep the user-facing contract as one final SQL; do not expose intermediate SQL/results. The feature defaults on in code but must fall back to the legacy single-SQL path on any subquery-stage failure.

### 2026-05-15 16:35 CST - Run Denodo decomposition before SQL reasoning

- Decision: Denodo complex-query decomposition should run after Denodo scope resolution / query normalization and before `sql_generation_reasoning`.
- Reason: Reasoning quality should benefit from the same decomposition that later guides final SQL generation; running it after reasoning leaves the hardest planning step as a single-pass problem.
- Consequence: Reasoning prompts receive hidden non-SQL decomposition context. The UI may show a lightweight subtask summary after selected scope and normalized query, but never exposes subquery SQL or validation details.

### 2026-05-16 17:04 CST - Sanitize direct Denodo VQL expressions without remapping identifiers

- Decision: Direct `DIALECT` Denodo SQL should skip manifest table/column remapping but still pass through a narrow expression-only sanitizer before MCP validation.
- Reason: Direct VQL generation can still produce portable SQL functions that Denodo rejects, such as `AVG(TO_NUMBER(package_price))`; fully running `toDenodoNativeSql` would risk corrupting already-native Denodo identifiers.
- Consequence: Keep the sanitizer limited to expression rewrites such as `TO_NUMBER` to `CAST(... AS DECIMAL(18, 2))`, date bucket normalization, cast target normalization, and parser cleanup. Continue using full `toDenodoNativeSql` only for non-`DIALECT` fallback candidates.

### 2026-05-16 17:29 CST - Treat Denodo validate tool exceptions as correctable SQL failures

- Decision: If Denodo MCP validation throws during SQL validation, the UI guard should record the exception as an invalid validation attempt and run the existing SQL correction loop.
- Reason: Some Denodo/MCP parser failures surface as tool exceptions, for example `Cannot read properties of null (reading 'id')`, even when the next useful action is to rewrite the SQL rather than fail the ask.
- Consequence: Validation exceptions now appear in timing/SQL trace as invalid attempts. Infrastructure-level failures may still consume a correction attempt, but the user-facing ask path becomes more resilient for recoverable SQL-shape issues.

### 2026-05-16 17:51 CST - Preserve Denodo context when narrowing semantic dictionaries

- Decision: Denodo selected-model scoping may narrow semantic dictionary entries, but it must preserve the Denodo context marker and native VQL schema mapping.
- Reason: The marker controls Denodo VQL prompt selection and skips AI-service Wren-engine dry-run. Replacing the entire semantic context with a scoped dictionary summary makes executable Denodo VQL look like generic SQL and triggers misleading dry-run failures.
- Consequence: Scoped Denodo semantic context should replace only the `Semantic dictionary entries:` section. Any future context-pruning logic must keep `[[WREN_DENODO_CONTEXT]]` and native view/column mapping intact.

### 2026-05-20 17:09 CST - Add dedicated external research task agent

- Decision: Add Codex task agent `7. 外部调研` for studying external Git repositories, SDKs, papers, docs, and comparable projects.
- Reason: Research work has a different output shape than implementation work; it should create source-backed developer handoffs that other agents can use without re-reading the external project.
- Consequence: External research should capture source refs, commit/tag/date, reusable patterns, integration implications, risks, and documentation paths. Scratch material should stay under `.tmp/external-research/`; durable results should live in `docs/research/` when useful.

## Archived Decisions

None yet.
