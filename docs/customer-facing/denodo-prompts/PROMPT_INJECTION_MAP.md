# Prompt Injection Map

Last updated: 2026-05-26 15:05 CST

This document maps every runtime path found in this repository that injects text into an LLM request. It separates direct prompt construction from indirect context sources so future prompt changes do not cross hidden boundaries.

## Scope

- Direct prompt injection means a file either defines a system/user prompt template, calls `llm_provider.get_generator(...)`, or passes `prompt=...`, `current_system_prompt=...`, or `history_messages=...` into the generator.
- Indirect prompt injection means a file stores, retrieves, or forwards user/business/semantic context that later becomes part of a direct prompt.
- Not included as model prompt injection: frontend prompt input components, Go `promptui` CLI prompts, Docker/Kubernetes LLM config wiring, embedding-only retrieval calls, and tests that only assert prompt text.

## LLM Boundary

| File | Injected material | Boundary and comment |
| --- | --- | --- |
| `wren-ai-service/src/providers/llm/litellm.py` | Final chat message array. Optional system prompt, optional history messages, final user prompt. | This is the central model boundary. `system_prompt` or `current_system_prompt` becomes `ChatMessage.from_system(...)`; PromptBuilder output becomes `ChatMessage.from_user(...)`; follow-up history is inserted between system and current user message. All pipeline prompts eventually cross this file. |
| `wren-ai-service/src/pipelines/generation/utils/sql.py` | Shared SQL rules, SQL generation system prompt, reasoning system prompt, SQL knowledge fallback rules, history message builder. | Shared SQL prompt root. `get_sql_generation_system_prompt(...)` is used by SQL generation, follow-up generation, and Denodo subquery fallback. `construct_ask_history_messages(...)` turns previous question/SQL pairs into chat history; this is conversation context, not a string section inside the current user prompt. |

## Ask / Text-To-SQL

| File | Prompt pieces | Boundary and purpose |
| --- | --- | --- |
| `wren-ai-service/src/pipelines/generation/intent_classification.py` | `intent_classification_system_prompt`, `intent_classification_user_prompt_template`. | Classifies user input into `TEXT_TO_SQL`, `GENERAL`, `USER_GUIDE`, or `MISLEADING_QUERY`; also rewrites follow-up questions. Input includes retrieved schema, SQL samples, user instructions, user guide snippets, and history. It should not generate SQL. |
| `wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py` | `table_columns_selection_system_prompt`, `table_columns_selection_user_prompt_template`. | LLM-assisted column pruning when schema context is too large or forced. It selects relevant table columns for the later SQL prompt. Boundary is retrieval narrowing; output is schema subset, not final SQL. |
| `wren-ai-service/src/pipelines/generation/scope_resolution.py` | `scope_resolution_user_prompt_template`. | Denodo semantic scope selector. Picks `primary_model`, `secondary_models`, and `needs_join` from candidate models. Its output becomes a hard SQL allowed-table boundary downstream. Metric formulas are only optional evidence here, not SQL instructions. |
| `wren-ai-service/src/pipelines/generation/query_normalization.py` | `query_normalization_user_prompt_template`. | Denodo canonical value normalization. Rewrites natural-language phrases only when grounded in scoped dictionaries. Boundary: produces `normalized_query` and matched rewrites; it must not inject physical column names into the user query. |
| `wren-ai-service/src/pipelines/generation/sql_generation_reasoning.py` | `sql_generation_reasoning_user_prompt_template` plus shared `sql_generation_reasoning_system_prompt`. | Produces a user-visible reasoning plan before SQL generation. Includes schema, semantic context, samples, user instructions, selected models, matched rewrites, decomposition context, current time. Boundary: no SQL in the reasoning output. |
| `wren-ai-service/src/pipelines/generation/followup_sql_generation_reasoning.py` | Follow-up reasoning user template plus shared reasoning system prompt. | Same as SQL reasoning, but also injects prior question/SQL history into the prompt body. Boundary: planning only; still no SQL output. |
| `wren-ai-service/src/pipelines/generation/sql_generation.py` | `sql_generation_user_prompt_template`, dynamic system prompt from ANSI or Denodo VQL. | Main SQL generation. Injects schema, calculated field/metric/JSON-field instructions, SQL functions, SQL samples, user instructions, semantic dictionary/context, selected models, matched rewrites, internal subquery drafts, hidden exemplar context, original/normalized question, reasoning plan, and critical Denodo constraints. Boundary: returns one SQL JSON object; selected models are the hard table set for Denodo. |
| `wren-ai-service/src/pipelines/generation/followup_sql_generation.py` | `text_to_sql_with_followup_user_prompt_template`, dynamic system prompt, chat history messages. | Follow-up SQL generation. Prompt body includes current schema/context plus previous reasoning; prior turns are also injected as chat history. Boundary: generate a new SQL for the follow-up, not an explanation. |
| `wren-ai-service/src/pipelines/generation/sql_correction.py` | `get_sql_correction_system_prompt(...)`, `sql_correction_user_prompt_template`, Denodo correction override. | Corrects invalid SQL/VQL using schema, SQL functions, user instructions, semantic context, selected models, matched rewrites, samples, hidden exemplar, original/normalized question, invalid SQL, and error message. Boundary: correction should not introduce unselected Denodo views. |
| `wren-ai-service/src/pipelines/generation/sql_regeneration.py` | `get_sql_regeneration_system_prompt(...)`, `sql_regeneration_user_prompt_template`. | Regenerates SQL from an original SQL plus reasoning. Boundary: ANSI path only in current code; does not include Denodo semantic normalization extras. |
| `wren-ai-service/src/pipelines/generation/denodo_query_decomposition.py` | `denodo_query_decomposition_system_prompt`, `denodo_query_decomposition_user_prompt_template`. | Denodo planning stage for complex questions. Produces JSON subquery specs and final assembly instructions, not SQL. Boundary: hidden/internal planning; UI only receives summary, not subquery SQL. |
| `wren-ai-service/src/pipelines/generation/denodo_subquery_generation.py` | `denodo_subquery_generation_user_prompt_template`, dynamic Denodo/ANSI generation system prompt. | Generates internal CTE-compatible Denodo VQL draft for one decomposed subquery. Boundary: draft guidance only; final answer must still be one complete VQL query. |
| `wren-ai-service/src/pipelines/generation/denodo_prompt_context.py` | Denodo VQL system prompts, technical rules, runtime business formula instructions, temporal Top-N/decline instructions, hidden SQL exemplar. | Denodo-specific prompt source of truth. Also detects Denodo context marker and formats runtime metric formulas. Boundary: static rules and runtime formula instructions are injected as `USER INSTRUCTIONS`; hidden exemplar is injected only into final/follow-up SQL generation and correction, not UI-visible reasoning. |

## Answering, Charts, And Assistance

| File | Prompt pieces | Boundary and purpose |
| --- | --- | --- |
| `wren-ai-service/src/pipelines/generation/sql_answer.py` | `sql_to_answer_system_prompt`, `sql_to_answer_user_prompt_template`. | Converts SQL result rows into a non-technical answer. Injects question, SQL, result data, language, current time, and custom instruction. Boundary: grounded explanation only; should not invent unsupported business causes. |
| `wren-ai-service/src/pipelines/generation/chart_generation.py` | `chart_generation_system_prompt`, `chart_generation_user_prompt_template`. | Generates Vega-Lite chart JSON and chart type from question, SQL, sample data, sample column values, language, and custom instruction. Boundary: chart schema generation only. |
| `wren-ai-service/src/pipelines/generation/chart_adjustment.py` | `chart_adjustment_system_prompt`, `chart_adjustment_user_prompt_template`. | Regenerates chart schema from an existing chart plus adjustment options. Boundary: may return empty chart/schema when adjustment is unsuitable. |
| `wren-ai-service/src/pipelines/generation/data_assistance.py` | `data_assistance_system_prompt`, `data_assistance_user_prompt_template`. | Answers general data/schema questions when intent is not SQL generation. Injects schema, question, language, history-derived question text, and custom instruction. Boundary: no SQL code. |
| `wren-ai-service/src/pipelines/generation/misleading_assistance.py` | `misleading_assistance_system_prompt`, `misleading_assistance_user_prompt_template`. | Handles misleading/off-topic questions by suggesting better data questions. Injects schema and question. Boundary: no SQL code; short guidance only. |
| `wren-ai-service/src/pipelines/generation/user_guide_assistance.py` | `user_guide_assistance_system_prompt`, `user_guide_assistance_user_prompt_template`. | Answers Wren AI usage questions from user-guide docs. Boundary: cite guide docs and say when no relevant answer exists. |
| `wren-ai-service/src/pipelines/generation/sql_diagnosis.py` | `sql_diagnosis_system_prompt`, `sql_diagnosis_user_prompt_template`. | Diagnoses invalid SQL by comparing original SQL, invalid SQL, error message, and schema. Boundary: returns concise JSON reasoning, not corrected SQL. |

## Metadata And Modeling Helpers

| File | Prompt pieces | Boundary and purpose |
| --- | --- | --- |
| `wren-ai-service/src/pipelines/generation/sql_tables_extraction.py` | `sql_tables_extraction_system_prompt`, `sql_tables_extraction_user_prompt_template`. | Extracts table names from arbitrary SQL. Boundary: JSON list of tables only. |
| `wren-ai-service/src/pipelines/generation/sql_question.py` | `sql_question_system_prompt`, `sql_question_user_prompt_template`. | Translates SQL into a natural-language question. Boundary: one concise question in configured language. |
| `wren-ai-service/src/pipelines/generation/question_recommendation.py` | `system_prompt`, `user_prompt_template`. | Generates suggested analytical questions from schema and optional previous questions/categories. Boundary: JSON recommendations only. |
| `wren-ai-service/src/pipelines/generation/relationship_recommendation.py` | `system_prompt`, `user_prompt_template`. | Suggests MDL relationships from model definitions. Boundary: validated relationship JSON; same-model and invalid-column relationships are filtered after generation. |
| `wren-ai-service/src/pipelines/generation/semantics_description.py` | `system_prompt`, `user_prompt_template`. | Adds model/column descriptions based on a user prompt and selected models. Boundary: returns only descriptions for selected models/columns. |
| `wren-ai-service/src/pipelines/generation/semantic_dictionary.py` | `system_prompt`, `user_prompt_template`. | Generates aliases/descriptions for scoped canonical-value dictionary tasks. Boundary: only fills listed tasks; does not invent canonical values, joins, metrics, or fields. |

## Indirect Context Injection

| File | Injected context | Boundary and comment |
| --- | --- | --- |
| `wren-ai-service/src/pipelines/indexing/instructions.py` | User/project instructions indexed into Qdrant. | Stores prompt-affecting instructions as documents. Default instructions have global content; non-default instructions are tied to example questions. No LLM call here. |
| `wren-ai-service/src/pipelines/retrieval/instructions.py` | Retrieved instructions returned as `{ instruction, question, instruction_id }`. | Feeds `USER INSTRUCTIONS` sections in SQL reasoning/generation/correction and intent classification. Boundary: retrieval and formatting only. |
| `wren-ai-service/src/web/v1/services/ask.py` | Orchestrates instruction retrieval, Denodo runtime instructions, semantic context, selected models, normalized query, decomposition, hidden exemplar, metric formulas. | Main Ask chain boundary. It decides when context is passed into each pipeline, but most prompt text is still defined in pipeline files. Important: Denodo runtime instructions are built before/after scope narrowing with different inclusion rules. |
| `wren-ai-service/src/web/v1/services/sql_corrections.py` | Adds Denodo runtime instructions to correction requests. | Correction-specific orchestration. It can inject Denodo technical/business formula rules into `sql_correction.py` through the `instructions` input. |
| `wren-ui/src/apollo/server/utils/denodoMcp.ts` | Denodo AI semantic context marker, native VQL schema mapping, semantic dictionary context. | UI-side Denodo context builder. It creates `[[WREN_DENODO_CONTEXT]]`, tells AI service to generate Denodo VQL, and supplies native view/column mappings. Boundary: this text is not sent directly to an LLM in UI; it is forwarded to AI service as `semantic_context`. |
| `wren-ui/src/apollo/server/services/askingService.ts` | User question, history, language config, Denodo semantic context, semantic dictionary, enabled metric formulas. | UI Ask entry. Builds the payload that later appears in AI-service prompt sections. Boundary: no local LLM call. |
| `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts` | REST payloads for ask, SQL correction, answer, chart, SQL question, instructions, feedback. | Transport boundary from UI to AI service. Prompt-affecting fields include `query`, `histories`, `configurations`, `semantic_context`, `semantic_dictionary`, `metric_formulas`, SQL/error payloads, and instruction records. |
| `wren-ui/src/apollo/server/services/denodoSqlGuardService.ts` | Builds scoped Denodo correction semantic context and calls AI-service SQL correction after MCP validation failure. | UI Denodo validation/correction loop. Boundary: it can trigger another AI-service correction prompt with native VQL schema context narrowed to selected/retrieved models. |
| `wren-ui/src/apollo/server/services/metricFormulaService.ts` | File-backed metric formulas loaded from `metric-formulas.json`. | Business formula storage boundary. Formulas are not prompt text until Ask passes enabled formulas to AI service and `denodo_prompt_context.py` formats matching rules. |
| `wren-ui/data/metric-formulas.json` | Runtime Denodo business formula rules, trigger phrases, forbidden patterns, extra instructions. | Editable business prompt content. Boundary: applies only to enabled Denodo formulas whose scope matches selected/retrieved models. |
| `wren-ui/src/apollo/server/services/instructionService.ts` | CRUD for user/project instructions, then forwards them to AI-service indexing. | User-managed instruction source. Boundary: length-limited UI instruction data; actual retrieval/injection happens in AI service. |
| `wren-launcher/commands/launch.go` | `validateOpenaiApiKey` sends user message `Hello!` to GPT-4o mini. | One-off setup validation call, not product ChatBI prompt path. Include it because it is a direct model message in the repo. |

## Config Files

`docker/config.yaml`, `docker/config.example.yaml`, `docker/customer-x86/config.customer.yaml`, and `deployment/kustomizations/base/cm.yaml` wire pipeline names to LLM/embedder providers. They affect which model receives prompts, but they do not contain prompt text or inject prompt sections.

## Practical Editing Boundaries

- Change SQL behavior first in `wren-ai-service/src/pipelines/generation/utils/sql.py`, `sql_generation.py`, `sql_correction.py`, and, for Denodo, `denodo_prompt_context.py`.
- Change Denodo routing before SQL in `scope_resolution.py`, `query_normalization.py`, and UI `denodoMcp.ts` context builders.
- Change runtime business formula behavior in `wren-ui/data/metric-formulas.json` or `metricFormulaService.ts`; verify how `denodo_prompt_context.py` formats it.
- Change answer tone in `sql_answer.py`; change chart behavior in `chart_generation.py` / `chart_adjustment.py`; change non-SQL assistance in `data_assistance.py`, `misleading_assistance.py`, and `user_guide_assistance.py`.
- Do not treat `prompt` in frontend component names or Go `promptui` as LLM prompt injection.
