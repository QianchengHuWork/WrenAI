#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = "wren-ui/.tmp/ask-sql-trace.jsonl";
const DEFAULT_TIMING = "wren-ui/.tmp/ask-timing.jsonl";
const DEFAULT_OUTPUT = "wren-ui/.tmp/ask-sql-trace.md";

const usage = () => `
Usage:
  node scripts/ask-sql-trace-markdown.mjs [options]

Options:
  --input <file>        Source ask SQL trace JSONL. Default: ${DEFAULT_INPUT}
  --timing <file>       Optional ask timing JSONL. Default: ${DEFAULT_TIMING}
  --out <file>          Output Markdown file. Default: ${DEFAULT_OUTPUT}
  --questions <file>    Optional question JSON file for questionId mapping.
  --run-label <label>   Optional label shown in the report header.
`;

const parseArgs = (argv) => {
  const args = {
    input: DEFAULT_INPUT,
    timing: DEFAULT_TIMING,
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
    else if (name === "timing") args.timing = value;
    else if (name === "out") args.out = value;
    else if (name === "questions") args.questions = value;
    else if (name === "run-label") args.runLabel = value;
    else throw new Error(`Unknown option: ${key}`);
    index += 1;
  }

  return args;
};

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

const readJsonl = async (file, { optional = false } = {}) => {
  try {
    const input = await fs.readFile(file, "utf8");
    return input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line !== "{}")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    throw error;
  }
};

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

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatMs = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  const ms = Number(value);
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
};

const stepDuration = (steps, name) => {
  const step = steps.find((item) => item?.name === name);
  return step ? Number(step.durationMs || 0) : null;
};

const buildTimingByQueryId = (timingRows) => {
  const byQueryId = new Map();
  for (const row of timingRows) {
    if (row?.event !== "ask_finished" || !row.askQueryId) continue;
    const steps = Array.isArray(row.steps) ? row.steps : [];
    byQueryId.set(row.askQueryId, {
      status: row.status || null,
      askTotalMs: stepDuration(steps, "ai.ask_total"),
      question: row.question || null,
      traceId: row.traceId || null,
      selectedModels: row.selectedModels || null,
    });
  }
  return byQueryId;
};

const codeFence = (value, language = "sql") => {
  const raw = String(value ?? "");
  const longestRun = Math.max(
    2,
    ...Array.from(raw.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${language}\n${raw}\n${fence}`;
};

const appendField = (parts, label, value) => {
  if (value === null || value === undefined || value === "") return;
  parts.push(`**${label}**`);
  parts.push("");
  parts.push(String(value));
  parts.push("");
};

const appendSqlField = (parts, label, value) => {
  if (value === null || value === undefined || value === "") return;
  parts.push(`**${label}**`);
  parts.push("");
  parts.push(codeFence(value));
  parts.push("");
};

const eventSummary = (entry, index) => {
  const attempt =
    entry.attempt === null || entry.attempt === undefined
      ? `event ${index + 1}`
      : `attempt ${entry.attempt}`;
  return [
    attempt,
    entry.stage || "unknown_stage",
    formatMs(entry.durationMs),
    entry.status || "-",
  ].join(" | ");
};

const renderEventDetails = (entry, index) => {
  const parts = [];
  parts.push("<details>");
  parts.push(`<summary>${escapeHtml(eventSummary(entry, index))}</summary>`);
  parts.push("");

  const timings = [
    entry.generationDurationMs !== undefined
      ? `generation=${formatMs(entry.generationDurationMs)}`
      : null,
    entry.diagnosisDurationMs !== undefined
      ? `diagnosis=${formatMs(entry.diagnosisDurationMs)}`
      : null,
    entry.validationDurationMs !== undefined
      ? `validation=${formatMs(entry.validationDurationMs)}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  appendField(parts, "Timings", timings);
  appendField(parts, "Correction Query ID", entry.correctionQueryId);
  appendField(parts, "Error", entry.error);

  if (entry.stage === "denodo_guard_validate_attempt") {
    appendSqlField(parts, "Candidate SQL", entry.candidateSql);
    appendSqlField(parts, "Native SQL", entry.nativeSql);
    appendSqlField(
      parts,
      "Semantic Rewrite Before SQL",
      entry.semanticRewriteBeforeSql,
    );
    appendSqlField(
      parts,
      "Semantic Rewrite After SQL",
      entry.semanticRewriteAfterSql,
    );
    appendSqlField(
      parts,
      "Dense Rank Rewrite Before SQL",
      entry.denseRankRewriteBeforeSql,
    );
    appendSqlField(
      parts,
      "Dense Rank Rewrite After SQL",
      entry.denseRankRewriteAfterSql,
    );
    appendSqlField(parts, "Validate SQL", entry.validateSql || entry.sql);
  } else if (entry.stage?.includes("correction")) {
    appendSqlField(parts, "Correction Input SQL", entry.beforeSql);
    appendSqlField(parts, "Original SQL", entry.originalSql);
    appendSqlField(parts, "Correction Output SQL", entry.afterSql || entry.sql);
  } else {
    appendSqlField(parts, "Original SQL", entry.originalSql);
    appendSqlField(parts, "Before SQL", entry.beforeSql);
    appendSqlField(parts, "After SQL", entry.afterSql);
    appendSqlField(parts, "SQL", entry.sql);
  }

  parts.push("</details>");
  return parts.join("\n");
};

const groupTraceRows = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    if (row?.event !== "ask_sql_trace") continue;
    const key = row.askQueryId || row.traceId || row.question || "unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  return groups;
};

const renderReport = ({
  traceRows,
  timingByQueryId,
  questionIdMap,
  runLabel,
}) => {
  const groups = groupTraceRows(traceRows);
  const lines = [];
  lines.push("# Ask SQL Trace");
  lines.push("");
  if (runLabel) {
    lines.push(`Run label: ${runLabel}`);
    lines.push("");
  }
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  for (const [key, entries] of groups.entries()) {
    const first = entries[0] || {};
    const timing = timingByQueryId.get(first.askQueryId) || {};
    const question = first.question || timing.question || "";
    const questionId = questionIdMap.get(question) || null;
    const status = timing.status || first.status || "-";
    const askTotalMs = timing.askTotalMs;
    const traceId = first.traceId || timing.traceId || null;
    const titleParts = [
      questionId || "unmapped",
      status,
      formatMs(askTotalMs),
      first.askQueryId || key,
    ];

    lines.push(`## ${titleParts.filter(Boolean).join(" | ")}`);
    lines.push("");
    if (question) {
      lines.push(`**Question**: ${question}`);
      lines.push("");
    }
    if (traceId) {
      lines.push(`**Trace ID**: ${traceId}`);
      lines.push("");
    }

    entries.forEach((entry, index) => {
      lines.push(renderEventDetails(entry, index));
      lines.push("");
    });
  }

  return lines.join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const [traceRows, timingRows, questionIdMap] = await Promise.all([
    readJsonl(args.input),
    readJsonl(args.timing, { optional: true }),
    buildQuestionIdMap(args.questions),
  ]);

  const markdown = renderReport({
    traceRows,
    timingByQueryId: buildTimingByQueryId(timingRows),
    questionIdMap,
    runLabel: args.runLabel,
  });

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${markdown}\n`, "utf8");

  process.stdout.write(
    JSON.stringify(
      {
        input: args.input,
        timing: args.timing,
        output: args.out,
        rows: traceRows.length,
      },
      null,
      2,
    ) + "\n",
  );
};

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
