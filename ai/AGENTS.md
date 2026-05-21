# Multi-Agent Collaboration Protocol

This repository uses `/ai` as the persistent shared memory layer for AI coding assistants.

Supported agents: Codex, Claude, Gemini, Cursor, ChatGPT, Copilot, and future MCP-enabled agents.

## Mandatory Startup

Before implementation decisions, every agent must read:

- `/AGENTS.md`
- `/ai/AGENTS.md`
- `/ai/AI_CONTEXT.md`
- `/ai/ACTIVE_STATE.md`
- `/ai/DECISIONS.md`

Before coding, also check:

- `/ai/TASKS.md` for pending work
- `/ai/CHANGELOG.md` for recent changes
- `git status --short` and current branch

Do not ignore historical decisions unless they are explicitly marked obsolete.

## Collaboration Rules

- Treat `/ai` files as operational memory, not optional documentation.
- Preserve user changes and other agents' work.
- Prefer small, reviewable edits aligned with existing repository patterns.
- Record assumptions that affect future agents.
- Use English for technical notes. Chinese is allowed for business context and human-facing notes.
- Keep memory concise, factual, and deduplicated.

## Memory Update Rules

Update memory after significant work:

- Architecture changes: update `/ai/AI_CONTEXT.md` and append `/ai/DECISIONS.md`.
- Current branch/task/debugging changes: update `/ai/ACTIVE_STATE.md`.
- New, blocked, or completed work: update `/ai/TASKS.md`.
- Any meaningful change: append `/ai/CHANGELOG.md`.

Significant work includes:

- schema or MDL changes
- prompt strategy or text-to-SQL behavior changes
- RAG retrieval/indexing changes
- Denodo semantic layer changes
- deployment/configuration changes
- dependency changes
- MCP/tool integration changes
- debugging breakthroughs or confirmed root causes

Append timestamped notes for durable history. Rewrite only compact active summaries, and only to remove stale or duplicated state.

## Context Hygiene

- Active state should fit in one screen when possible.
- Move obsolete details to archived sections instead of deleting decisions.
- Do not store raw logs unless they are necessary to reproduce a bug.
- Deduplicate repeated context across files; link to the canonical file instead.
- Prefer bullets, tables, and short operational notes.

## Repository Conventions

- Monorepo services:
  - `wren-ui/`: Next.js 14, Apollo GraphQL backend, TypeScript, Yarn 4.5.3.
  - `wren-ai-service/`: FastAPI AI service, Python 3.12, Poetry, Just.
  - `wren-launcher/`: Go CLI deployment tool.
  - `docker/`: Docker Compose configs.
  - `deployment/`: Kubernetes/Kustomize manifests.
  - `wren-mdl/`: MDL schema.
  - `wren-engine/`: SQL engine submodule; do not casually edit here.
- Path aliases in UI: `@/* -> ./src/*`, `@server/* -> ./src/apollo/server/*`.
- Commit convention: `type(scope): description`, e.g. `fix(wren-ui): handle denodo filters`.

## Build And Test Commands

`wren-ui`:

```bash
cd wren-ui
yarn install
yarn lint
yarn test
yarn build
```

`wren-ai-service`:

```bash
cd wren-ai-service
poetry install
just init
just test
just start
```

`wren-launcher`:

```bash
cd wren-launcher
make test
make check
```

## Branch Workflow

- Inspect `git status --short` before editing.
- Treat unrelated dirty files as user/agent-owned; do not revert them.
- Use `codex/` prefix for new Codex-created branches unless instructed otherwise.
- Keep service-specific changes scoped where possible.
- Before handoff, record branch status and uncommitted work in `/ai/ACTIVE_STATE.md`.

## Debugging Workflow

1. Reproduce or identify the failing path.
2. Note impacted boundary: UI GraphQL, AI service, engine, Ibis, Qdrant, LLM, or Denodo.
3. Capture commands, inputs, and concise findings in `/ai/ACTIVE_STATE.md`.
4. Promote confirmed root causes or architectural lessons to `/ai/DECISIONS.md` or `/ai/AI_CONTEXT.md`.
5. Add follow-up tasks to `/ai/TASKS.md`.

## External Research Workflow

Use Codex task agent `7. 外部调研` for external Git repositories, SDKs, papers, docs, or comparable projects.

Rules:

- Record the research target, URL/path, commit/tag/date, and research question.
- Prefer primary sources: source code, official docs, release notes, papers, or vendor docs.
- Clone or unpack scratch material under ignored paths such as `.tmp/external-research/`.
- Do not copy external code into this repo unless license and attribution are checked.
- Produce a concise developer handoff: findings, reusable patterns, integration implications, risks, and next implementation steps.
- Put durable research docs under `docs/research/` when the result should guide future agents.
- Update `/ai/ACTIVE_STATE.md`, `/ai/TASKS.md`, and `/ai/CHANGELOG.md` after significant research.
- Promote durable architectural conclusions to `/ai/AI_CONTEXT.md` or `/ai/DECISIONS.md`.

## Task Tracking Workflow

Use `/ai/TASKS.md` as the shared queue:

- `Todo`: accepted but not started.
- `Doing`: active across current branch/session.
- `Blocked`: waiting on external input, dependency, environment, or decision.
- `Done`: completed with date and verification note.

Keep task titles stable so different agents can refer to the same work item.

## Documentation Conventions

- Use concise Markdown.
- English is primary for technical implementation.
- Chinese is acceptable for business background, user language, and delivery notes.
- Add timestamps as `YYYY-MM-DD HH:mm TZ` or ISO-8601 when useful.
- Prefer repo-relative paths in memory files.

## Starter Domains

- ChatBI: natural language analytics, query explanation, charts, dashboards.
- RAG: MDL/schema indexing, retrieval ranking, historical SQL pairs, semantic examples.
- Text-to-SQL: intent classification, SQL generation, validation, correction, dialect constraints.
- Denodo semantic layer: selected views, business dictionaries, flags/enums, VQL compatibility.
- Agent workflow: cross-agent context handoff, branch/task state, debugging notes.
- MCP integration: tools that expose schema, docs, trace search, or data-source metadata to agents.
- Semantic routing: classify question intent, route to model/domain/tool/pipeline before generation.
- External research: study outside projects and produce implementation-oriented docs for other task agents.

## Example Memory Update

```markdown
### 2026-05-15 10:30 CST
- Changed: Added Denodo flag normalization before SQL validation.
- Verified: `yarn test denodoSqlGuardService.test.ts`.
- Follow-up: Add benchmark questions for refund/payment/delivery flags.
```

## Principle

These files are the primary source of project state for AI collaboration. Keep them accurate enough that a new assistant can continue work without the previous chat.
