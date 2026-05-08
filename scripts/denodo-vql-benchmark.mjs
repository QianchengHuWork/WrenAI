#!/usr/bin/env node

import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";

const DEFAULT_ENDPOINT = "/api/v1/generate_sql";

const usage = () => `
Usage:
  node scripts/denodo-vql-benchmark.mjs --base-url http://localhost:3000 --questions questions.json --out result.json

Options:
  --base-url <url>      Wren UI base URL. Default: http://localhost:3000
  --endpoint <path>     API endpoint. Default: ${DEFAULT_ENDPOINT}
  --questions <file>    JSON array of strings or { "id", "question" } objects.
  --baseline <file>     Optional previous benchmark output to compare against.
  --out <file>          Optional output JSON file.
  --repeat <n>          Runs per question. Default: 1
  --language <lang>     Optional API language value.
  --header <k:v>        Optional HTTP header. Repeatable.
`;

const parseArgs = (argv) => {
  const args = {
    baseUrl: "http://localhost:3000",
    endpoint: DEFAULT_ENDPOINT,
    repeat: 1,
    headers: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--")) {
      throw new Error(`Unexpected argument: ${key}`);
    }

    if (key === "--header") {
      if (!value) throw new Error("--header requires a value");
      const separator = value.indexOf(":");
      if (separator < 1) {
        throw new Error('--header value must use "key:value" format');
      }
      args.headers[value.slice(0, separator).trim()] = value
        .slice(separator + 1)
        .trim();
      index += 1;
      continue;
    }

    if (!value) throw new Error(`${key} requires a value`);
    const name = key.slice(2);
    if (name === "base-url") args.baseUrl = value;
    else if (name === "endpoint") args.endpoint = value;
    else if (name === "questions") args.questions = value;
    else if (name === "baseline") args.baseline = value;
    else if (name === "out") args.out = value;
    else if (name === "repeat") args.repeat = Number(value);
    else if (name === "language") args.language = value;
    else throw new Error(`Unknown option: ${key}`);
    index += 1;
  }

  if (!args.questions) throw new Error("--questions is required");
  if (!Number.isInteger(args.repeat) || args.repeat < 1) {
    throw new Error("--repeat must be a positive integer");
  }

  return args;
};

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

const normalizeQuestions = (rawQuestions) => {
  if (!Array.isArray(rawQuestions)) {
    throw new Error("questions file must be a JSON array");
  }

  return rawQuestions.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `q${index + 1}`,
        question: item,
      };
    }

    if (item && typeof item.question === "string") {
      return {
        id: String(item.id || `q${index + 1}`),
        question: item.question,
      };
    }

    throw new Error(`Invalid question at index ${index}`);
  });
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const extractToolCalls = (body) => {
  const candidates = [
    body?.toolCalls,
    body?.tool_calls,
    body?.data?.toolCalls,
    body?.response?.toolCalls,
  ];
  return candidates.find(Array.isArray) || [];
};

const summarizeRuns = (runs) => {
  const successfulRuns = runs.filter((run) => run.ok);
  const durationMsValues = successfulRuns.map((run) => run.durationMs);
  const toolCalls = runs.flatMap((run) => run.toolCalls || []);
  const validateAttempts = toolCalls.filter((call) =>
    String(call).includes("validate_sql_query"),
  ).length;
  const correctionAttempts = toolCalls.filter((call) =>
    String(call).includes("sql_correction"),
  ).length;

  return {
    ok: successfulRuns.length === runs.length,
    runs: runs.length,
    successfulRuns: successfulRuns.length,
    medianDurationMs: median(durationMsValues),
    minDurationMs: durationMsValues.length
      ? Math.min(...durationMsValues)
      : null,
    maxDurationMs: durationMsValues.length
      ? Math.max(...durationMsValues)
      : null,
    validateAttempts,
    correctionAttempts,
  };
};

const normalizeBaselineCases = (baseline) => {
  const cases = Array.isArray(baseline) ? baseline : baseline?.cases;
  if (!Array.isArray(cases)) return new Map();
  return new Map(cases.map((item) => [String(item.id), item]));
};

const benchmarkQuestion = async ({
  url,
  headers,
  language,
  question,
  repeat,
}) => {
  const runs = [];

  for (let run = 1; run <= repeat; run += 1) {
    const startedAt = performance.now();
    let body;
    let status;
    let ok = false;
    let error;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          question: question.question,
          returnSqlDialect: true,
          ...(language ? { language } : {}),
        }),
      });
      status = response.status;
      body = await response.json().catch(() => undefined);
      ok = response.ok;
      if (!ok) error = body?.message || body?.error || response.statusText;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    runs.push({
      run,
      ok,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      sql: body?.sql,
      threadId: body?.threadId,
      toolCalls: extractToolCalls(body),
      error,
    });
  }

  return {
    ...question,
    ...summarizeRuns(runs),
    runsDetail: runs,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const questions = normalizeQuestions(await readJson(args.questions));
  const baseline = args.baseline
    ? normalizeBaselineCases(await readJson(args.baseline))
    : new Map();
  const url = new URL(args.endpoint, args.baseUrl).toString();

  const cases = [];
  for (const question of questions) {
    process.stdout.write(`Running ${question.id}: ${question.question}\n`);
    const result = await benchmarkQuestion({
      url,
      headers: args.headers,
      language: args.language,
      question,
      repeat: args.repeat,
    });
    const baselineCase = baseline.get(result.id);
    cases.push({
      ...result,
      baseline: baselineCase
        ? {
            medianDurationMs: baselineCase.medianDurationMs,
            validateAttempts: baselineCase.validateAttempts,
            correctionAttempts: baselineCase.correctionAttempts,
            deltaMedianDurationMs:
              result.medianDurationMs !== null &&
              baselineCase.medianDurationMs !== null
                ? result.medianDurationMs - baselineCase.medianDurationMs
                : null,
          }
        : undefined,
    });
  }

  const output = {
    endpoint: url,
    generatedAt: new Date().toISOString(),
    repeat: args.repeat,
    cases,
    summary: {
      total: cases.length,
      ok: cases.filter((item) => item.ok).length,
      medianDurationMs: median(
        cases
          .map((item) => item.medianDurationMs)
          .filter((value) => typeof value === "number"),
      ),
      validateAttempts: cases.reduce(
        (sum, item) => sum + item.validateAttempts,
        0,
      ),
      correctionAttempts: cases.reduce(
        (sum, item) => sum + item.correctionAttempts,
        0,
      ),
    },
  };

  const report = JSON.stringify(output, null, 2);
  if (args.out) {
    await fs.writeFile(args.out, `${report}\n`);
  }
  process.stdout.write(`${report}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n${usage()}`);
  process.exitCode = 1;
});
