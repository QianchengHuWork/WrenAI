import fs from 'fs';
import path from 'path';

export interface TimingStep {
  name: string;
  durationMs: number;
  metadata?: Record<string, any>;
}

export interface TimingTraceEntry {
  event: string;
  askQueryId?: string;
  answerQueryId?: string;
  traceId?: string;
  threadResponseId?: number;
  question?: string;
  status?: string;
  totalMs?: number;
  selectedModels?: Record<string, any>;
  validateCount?: number;
  correctionCount?: number;
  toolCalls?: string[];
  steps: TimingStep[];
}

const TIMING_TRACE_PATH = path.join(process.cwd(), '.tmp', 'ask-timing.jsonl');

export const nowMs = () => Date.now();

export const durationMsSince = (startedAt: number) =>
  Math.max(0, nowMs() - startedAt);

export const createTimingStep = (
  name: string,
  startedAt: number,
  metadata?: Record<string, any>,
): TimingStep => ({
  name,
  durationMs: durationMsSince(startedAt),
  ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
});

export const countToolCalls = (toolCalls: string[] = []) => ({
  validateCount: toolCalls.filter((call) =>
    call.includes('_validate_sql_query'),
  ).length,
  correctionCount: toolCalls.filter((call) =>
    call.includes('call AI service: sql_correction'),
  ).length,
});

export const appendTimingTrace = (entry: TimingTraceEntry) => {
  fs.mkdirSync(path.dirname(TIMING_TRACE_PATH), { recursive: true });
  fs.appendFileSync(
    TIMING_TRACE_PATH,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    })}\n`,
    'utf8',
  );
};
