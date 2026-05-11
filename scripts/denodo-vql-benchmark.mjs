#!/usr/bin/env node

import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";

const DEFAULT_MODE = "asking_task";
const DEFAULT_ENDPOINT = "/api/v1/generate_sql";
const DEFAULT_GRAPHQL_ENDPOINT = "/api/graphql";
const DEFAULT_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1_000;
const FINAL_ASKING_STATUSES = new Set(["FINISHED", "FAILED", "STOPPED"]);

const usage = () => `
Usage:
  node scripts/denodo-vql-benchmark.mjs --base-url http://localhost:3000 --questions questions.json --out result.json

Options:
  --base-url <url>      Wren UI base URL. Default: http://localhost:3000
  --mode <mode>         Benchmark mode: asking_task or generate_sql. Default: ${DEFAULT_MODE}
  --endpoint <path>     API endpoint for generate_sql mode. Default: ${DEFAULT_ENDPOINT}
  --graphql-endpoint <path>
                        GraphQL endpoint for asking_task mode. Default: ${DEFAULT_GRAPHQL_ENDPOINT}
  --questions <file>    JSON array of strings or { "id", "question" } objects.
  --baseline <file>     Optional previous benchmark output to compare against.
  --out <file>          Optional output JSON file.
  --repeat <n>          Runs per question. Default: 1
  --timeout-ms <n>      Per-run timeout budget in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}
  --language <lang>     Optional API language value for generate_sql mode.
  --header <k:v>        Optional HTTP header. Repeatable.
`;

const parseArgs = (argv) => {
  const args = {
    baseUrl: "http://localhost:3000",
    mode: DEFAULT_MODE,
    endpoint: DEFAULT_ENDPOINT,
    graphqlEndpoint: DEFAULT_GRAPHQL_ENDPOINT,
    repeat: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
    else if (name === "mode") args.mode = value;
    else if (name === "endpoint") args.endpoint = value;
    else if (name === "graphql-endpoint") args.graphqlEndpoint = value;
    else if (name === "questions") args.questions = value;
    else if (name === "baseline") args.baseline = value;
    else if (name === "out") args.out = value;
    else if (name === "repeat") args.repeat = Number(value);
    else if (name === "timeout-ms") args.timeoutMs = Number(value);
    else if (name === "language") args.language = value;
    else throw new Error(`Unknown option: ${key}`);
    index += 1;
  }

  if (!["asking_task", "generate_sql"].includes(args.mode)) {
    throw new Error('--mode must be either "asking_task" or "generate_sql"');
  }
  if (!args.questions) throw new Error("--questions is required");
  if (!Number.isInteger(args.repeat) || args.repeat < 1) {
    throw new Error("--repeat must be a positive integer");
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1) {
    throw new Error("--timeout-ms must be a positive integer");
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

const sleep = (durationMs) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

class BenchmarkRequestError extends Error {
  constructor(message, { httpStatus, body } = {}) {
    super(message);
    this.name = "BenchmarkRequestError";
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

const createTimeoutError = (timeoutMs) =>
  new Error(`Benchmark request timed out after ${timeoutMs} ms`);

const fetchJson = async ({ url, headers, body, timeoutMs }) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const parsedBody = text ? JSON.parse(text) : undefined;
    return { response, body: parsedBody };
  } catch (caught) {
    if (caught?.name === "AbortError") {
      throw createTimeoutError(timeoutMs);
    }
    throw caught;
  } finally {
    clearTimeout(timeoutId);
  }
};

const graphQLRequest = async ({ url, headers, query, variables, timeoutMs }) => {
  const { response, body } = await fetchJson({
    url,
    headers,
    timeoutMs,
    body: { query, variables },
  });

  if (!response.ok) {
    throw new BenchmarkRequestError(
      body?.errors?.[0]?.message || body?.message || response.statusText,
      {
        httpStatus: response.status,
        body,
      },
    );
  }

  if (body?.errors?.length) {
    throw new BenchmarkRequestError(
      body.errors.map((error) => error.message).join("; "),
      {
        httpStatus: response.status,
        body,
      },
    );
  }

  return {
    httpStatus: response.status,
    data: body?.data,
  };
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

const normalizeBaselineCases = (baseline) => {
  const cases = Array.isArray(baseline) ? baseline : baseline?.cases;
  if (!Array.isArray(cases)) return new Map();
  return new Map(cases.map((item) => [String(item.id), item]));
};

const createAskingTask = async ({
  graphqlUrl,
  headers,
  question,
  timeoutMs,
}) => {
  const mutation = `
    mutation CreateAskingTask($question: String!) {
      createAskingTask(data: { question: $question }) {
        id
      }
    }
  `;

  const { httpStatus, data } = await graphQLRequest({
    url: graphqlUrl,
    headers,
    query: mutation,
    variables: { question },
    timeoutMs,
  });

  return {
    httpStatus,
    taskId: data?.createAskingTask?.id,
  };
};

const getAskingTask = async ({ graphqlUrl, headers, taskId, timeoutMs }) => {
  const query = `
    query AskingTask($taskId: String!) {
      askingTask(taskId: $taskId) {
        status
        error {
          code
          shortMessage
          message
        }
        candidates {
          sql
        }
        selectedModels {
          primaryModel
          secondaryModels
          needsJoin
          reasoning
        }
        toolCalls
        traceId
        queryId
      }
    }
  `;

  const { httpStatus, data } = await graphQLRequest({
    url: graphqlUrl,
    headers,
    query,
    variables: { taskId },
    timeoutMs,
  });

  return {
    httpStatus,
    task: data?.askingTask,
  };
};

const benchmarkGenerateSql = async ({
  endpointUrl,
  headers,
  language,
  question,
  timeoutMs,
}) => {
  const { response, body } = await fetchJson({
    url: endpointUrl,
    headers,
    timeoutMs,
    body: {
      question: question.question,
      returnSqlDialect: true,
      ...(language ? { language } : {}),
    },
  });

  const ok = response.ok;
  return {
    ok,
    httpStatus: response.status,
    status: ok ? "FINISHED" : "FAILED",
    sql: body?.sql,
    threadId: body?.threadId,
    toolCalls: extractToolCalls(body),
    error: ok ? undefined : body?.message || body?.error || response.statusText,
  };
};

const benchmarkAskingTask = async ({
  graphqlUrl,
  headers,
  question,
  timeoutMs,
}) => {
  const deadline = Date.now() + timeoutMs;
  const getRemainingTime = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw createTimeoutError(timeoutMs);
    }
    return remaining;
  };

  const { httpStatus: createHttpStatus, taskId } = await createAskingTask({
    graphqlUrl,
    headers,
    question: question.question,
    timeoutMs: getRemainingTime(),
  });

  if (!taskId) {
    throw new BenchmarkRequestError("createAskingTask returned no task id", {
      httpStatus: createHttpStatus,
    });
  }

  while (true) {
    const { httpStatus, task } = await getAskingTask({
      graphqlUrl,
      headers,
      taskId,
      timeoutMs: getRemainingTime(),
    });

    if (!task) {
      await sleep(Math.min(POLL_INTERVAL_MS, getRemainingTime()));
      continue;
    }

    if (FINAL_ASKING_STATUSES.has(task.status)) {
      const ok = task.status === "FINISHED";
      return {
        ok,
        httpStatus,
        status: task.status,
        taskId,
        queryId: task.queryId,
        traceId: task.traceId,
        sql: task.candidates?.[0]?.sql,
        toolCalls: task.toolCalls || [],
        selectedModels: task.selectedModels,
        error: ok
          ? undefined
          : task.error?.message || `Task finished with status ${task.status}`,
      };
    }

    await sleep(Math.min(POLL_INTERVAL_MS, getRemainingTime()));
  }
};

const summarizeRuns = (runs) => {
  const successfulRuns = runs.filter((run) => run.ok);
  const durationMsValues = successfulRuns.map((run) => run.durationMs);
  const toolCalls = runs.flatMap((run) => run.toolCalls || []);
  const representativeRun =
    successfulRuns[successfulRuns.length - 1] || runs[runs.length - 1];
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
    status: representativeRun?.status,
    httpStatus: representativeRun?.httpStatus ?? null,
    taskId: representativeRun?.taskId,
    queryId: representativeRun?.queryId,
    traceId: representativeRun?.traceId,
    sql: representativeRun?.sql,
    selectedModels: representativeRun?.selectedModels,
    toolCalls: representativeRun?.toolCalls || [],
    error: representativeRun?.error,
    validateAttempts,
    correctionAttempts,
  };
};

const benchmarkQuestion = async ({
  endpointUrl,
  graphqlUrl,
  headers,
  language,
  mode,
  question,
  repeat,
  timeoutMs,
}) => {
  const runs = [];

  for (let run = 1; run <= repeat; run += 1) {
    const startedAt = performance.now();
    let result;

    try {
      result =
        mode === "asking_task"
          ? await benchmarkAskingTask({
              graphqlUrl,
              headers,
              question,
              timeoutMs,
            })
          : await benchmarkGenerateSql({
              endpointUrl,
              headers,
              language,
              question,
              timeoutMs,
            });
    } catch (caught) {
      result = {
        ok: false,
        httpStatus:
          caught instanceof BenchmarkRequestError ? caught.httpStatus : null,
        status: "FAILED",
        error: caught instanceof Error ? caught.message : String(caught),
      };
    }

    runs.push({
      run,
      ...result,
      durationMs: Math.round(performance.now() - startedAt),
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
  const endpointUrl = new URL(args.endpoint, args.baseUrl).toString();
  const graphqlUrl = new URL(args.graphqlEndpoint, args.baseUrl).toString();

  if (args.mode === "asking_task" && args.language) {
    process.stdout.write(
      "Warning: --language is ignored in asking_task mode because createAskingTask uses the current project language.\n",
    );
  }

  const cases = [];
  for (const question of questions) {
    process.stdout.write(`Running ${question.id}: ${question.question}\n`);
    const result = await benchmarkQuestion({
      endpointUrl,
      graphqlUrl,
      headers: args.headers,
      language: args.language,
      mode: args.mode,
      question,
      repeat: args.repeat,
      timeoutMs: args.timeoutMs,
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
    mode: args.mode,
    endpoint: args.mode === "asking_task" ? graphqlUrl : endpointUrl,
    graphqlEndpoint: graphqlUrl,
    generateSqlEndpoint: endpointUrl,
    generatedAt: new Date().toISOString(),
    repeat: args.repeat,
    timeoutMs: args.timeoutMs,
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
