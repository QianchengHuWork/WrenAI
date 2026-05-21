#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = "wren-ui/.tmp/ask-timing.jsonl";
const DEFAULT_OUTPUT = "wren-ui/.tmp/ask-timing.readable.jsonl";

const usage = () => `
Usage:
  node scripts/ask-timing-readable-jsonl.mjs [options]

Options:
  --input <file>        Source ask-timing JSONL. Default: ${DEFAULT_INPUT}
  --out <file>          Output readable JSONL. Default: ${DEFAULT_OUTPUT}
  --questions <file>    Optional question JSON file for questionId mapping.
  --run-label <label>   Optional label copied to every output row.
  --since <iso>         Include records at or after this timestamp.
  --until <iso>         Include records before or at this timestamp.
`;

const parseArgs = (argv) => {
  const args = {
    input: DEFAULT_INPUT,
    out: DEFAULT_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--")) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    if (key === "--help" || key === "-h") {
      args.help = true;
      continue;
    }
    if (!value) {
      throw new Error(`${key} requires a value`);
    }

    const name = key.slice(2);
    if (name === "input") args.input = value;
    else if (name === "out") args.out = value;
    else if (name === "questions") args.questions = value;
    else if (name === "run-label") args.runLabel = value;
    else if (name === "since") args.since = value;
    else if (name === "until") args.until = value;
    else throw new Error(`Unknown option: ${key}`);
    index += 1;
  }

  return args;
};

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

const buildQuestionIdMap = async (questionsFile) => {
  if (!questionsFile) return new Map();
  const questions = await readJson(questionsFile);
  if (!Array.isArray(questions)) {
    throw new Error("--questions file must be a JSON array");
  }

  return new Map(
    questions
      .filter((item) => item && typeof item.question === "string")
      .map((item, index) => [
        item.question,
        String(item.id || `q${index + 1}`),
      ]),
  );
};

const parseTime = (value, label) => {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return time;
};

const stepDuration = (steps, name) => {
  const step = steps.find((item) => item?.name === name);
  return step ? Number(step.durationMs || 0) : null;
};

const sumStepDurations = (steps, predicate) =>
  steps
    .filter((step) => step?.name && predicate(step.name))
    .reduce((total, step) => total + Number(step.durationMs || 0), 0);

const countSteps = (steps, predicate) =>
  steps.filter((step) => step?.name && predicate(step.name)).length;

const selectedModelsSummary = (selectedModels = {}) => ({
  primaryModel: selectedModels.primaryModel || null,
  secondaryModels: Array.isArray(selectedModels.secondaryModels)
    ? selectedModels.secondaryModels
    : [],
  needsJoin: selectedModels.needsJoin ?? null,
});

const toReadableRow = ({ entry, questionIdMap, runLabel }) => {
  const steps = Array.isArray(entry.steps) ? entry.steps : [];
  const validateAttemptCount = countSteps(steps, (name) =>
    /^denodo\.validate_attempt_\d+$/.test(name),
  );
  const sqlCorrectionAttemptCount = countSteps(steps, (name) =>
    /^ai\.sql_correction_attempt_\d+$/.test(name),
  );

  return {
    timestamp: entry.timestamp,
    ...(runLabel ? { runLabel } : {}),
    questionId: questionIdMap.get(entry.question) || null,
    question: entry.question || null,
    status: entry.status || null,
    askQueryId: entry.askQueryId || null,
    traceId: entry.traceId || null,
    ...selectedModelsSummary(entry.selectedModels),
    askTotalMs: stepDuration(steps, "ai.ask_total"),
    uiPollMs: stepDuration(steps, "ui.poll_until_ai_finished"),
    historicalQuestionMs: stepDuration(steps, "ai.historical_question"),
    instructionsRetrievalMs: stepDuration(steps, "ai.instructions_retrieval"),
    sqlPairsRetrievalMs: stepDuration(steps, "ai.sql_pairs_retrieval"),
    intentClassificationMs: stepDuration(steps, "ai.intent_classification"),
    dbSchemaRetrievalMs: stepDuration(steps, "ai.db_schema_retrieval"),
    scopeResolutionMs: stepDuration(steps, "ai.scope_resolution"),
    queryNormalizationMs: stepDuration(steps, "ai.query_normalization"),
    sqlGenerationReasoningMs: stepDuration(
      steps,
      "ai.sql_generation_reasoning",
    ),
    sqlFunctionsRetrievalMs: stepDuration(
      steps,
      "ai.sql_functions_retrieval",
    ),
    sqlGenerationMs: stepDuration(steps, "ai.sql_generation"),
    sqlDiagnosisMs: sumStepDurations(
      steps,
      (name) => name === "ai.sql_diagnosis",
    ),
    sqlCorrectionMs: sumStepDurations(steps, (name) =>
      /^ai\.sql_correction_attempt_\d+$/.test(name),
    ),
    denodoToNativeSqlMs: stepDuration(steps, "denodo.to_native_sql"),
    denodoSemanticDictionaryReadMs: stepDuration(
      steps,
      "denodo.semantic_dictionary_read",
    ),
    denodoSemanticRewriteMs: sumStepDurations(
      steps,
      (name) => name === "denodo.semantic_rewrite",
    ),
    denodoDenseRankRewriteMs: sumStepDurations(
      steps,
      (name) => name === "denodo.dense_rank_rewrite",
    ),
    denodoValidateMs: sumStepDurations(steps, (name) =>
      /^denodo\.validate_attempt_\d+$/.test(name),
    ),
    denodoGuardTotalMs: stepDuration(steps, "denodo.guard_total"),
    validateAttemptCount,
    sqlCorrectionAttemptCount,
    hasSqlCorrection: sqlCorrectionAttemptCount > 0,
    toolCallCount: Array.isArray(entry.toolCalls) ? entry.toolCalls.length : 0,
    validateCount: entry.validateCount ?? validateAttemptCount,
    correctionCount: entry.correctionCount ?? sqlCorrectionAttemptCount,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const questionIdMap = await buildQuestionIdMap(args.questions);
  const since = parseTime(args.since, "--since");
  const until = parseTime(args.until, "--until");
  const input = await fs.readFile(args.input, "utf8");
  const rows = [];
  let skipped = 0;

  for (const [lineIndex, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trim() === "{}") continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }

    if (entry.event !== "ask_finished") continue;
    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isNaN(timestamp)) {
      if (since !== null && timestamp < since) continue;
      if (until !== null && timestamp > until) continue;
    }

    rows.push(
      toReadableRow({
        entry: {
          ...entry,
          _line: lineIndex + 1,
        },
        questionIdMap,
        runLabel: args.runLabel,
      }),
    );
  }

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(
    args.out,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length ? "\n" : ""),
    "utf8",
  );

  process.stdout.write(
    JSON.stringify(
      {
        input: args.input,
        output: args.out,
        rows: rows.length,
        skippedMalformedJsonLines: skipped,
      },
      null,
      2,
    ) + "\n",
  );
};

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.stderr.write(usage());
  process.exitCode = 1;
});
