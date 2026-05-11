import { IDenodoMcpAdaptor, IWrenAIAdaptor } from '@server/adaptors';
import { Manifest } from '@server/mdl/type';
import { DataSourceName } from '@server/types';
import { Parser } from 'node-sql-parser';
import {
  AskResult,
  AskResultStatus,
  SQLDialect,
  SqlCorrectionResult,
  SqlCorrectionStatus,
  TimingEvent,
} from '@server/models/adaptor';
import {
  DENODO_MCP_CONNECTION_INFO,
  Project,
} from '@server/repositories';
import { toIbisConnectionInfo } from '@server/dataSource';
import { createTimingStep, getLogger, nowMs } from '@server/utils';
import * as Errors from '@server/utils/error';
import {
  buildDenodoAiSemanticContext,
  isDenodoSemanticDictionaryEnabled,
  buildDenodoMcpValidateToolName,
  getDenodoManifestPath,
  getDenodoRawSchemaPath,
  getDenodoSemanticDictionaryPath,
  readDenodoSemanticDictionary,
  toDenodoSemanticContext,
  toDenodoNativeSql,
  applySemanticDictionaryToSql,
} from '@server/utils/denodoMcp';

const logger = getLogger('DenodoSqlGuardService');
logger.level = 'debug';

const MAX_VALIDATE_ATTEMPTS = 3;
const MAX_CORRECTION_POLLS = 60;
const CORRECTION_POLL_INTERVAL = 1000;
const LOG_EMPTY_VALUE = '-';
const DENSE_RANK_SOURCE_ALIAS_PREFIX = 'denodo_rank_source';
const sqlParser = new Parser();

const safeLogValue = (value: unknown, limit = 240): string => {
  if (value === undefined || value === null) return LOG_EMPTY_VALUE;
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const rawValue =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  const normalized = rawValue.replace(/\s+/g, ' ').trim();
  if (!normalized) return LOG_EMPTY_VALUE;
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...(+${normalized.length - limit} chars)`;
};

const formatList = (
  values: Array<string | null | undefined>,
  limit = 6,
): string => {
  const normalized = values
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
    .map((value) => safeLogValue(value, 80));

  if (!normalized.length) return LOG_EMPTY_VALUE;
  if (normalized.length <= limit) return normalized.join(',');
  return `${normalized.slice(0, limit).join(',')},...(+${
    normalized.length - limit
  } more)`;
};

const formatSelectedModels = (
  selectedModels?: AskResult['selectedModels'],
): string => {
  if (!selectedModels) return LOG_EMPTY_VALUE;

  return [
    `primary=${safeLogValue(selectedModels.primaryModel, 80)}`,
    `secondary=${formatList(selectedModels.secondaryModels || [], 4)}`,
    `needs_join=${safeLogValue(selectedModels.needsJoin)}`,
  ].join(';');
};

const formatRewrites = (
  rewrites?: AskResult['matchedRewrites'],
  limit = 6,
): string => {
  if (!rewrites?.length) return LOG_EMPTY_VALUE;

  const normalized = rewrites.map((rewrite) => {
    const detail = `${safeLogValue(rewrite.scope.model, 80)}.${safeLogValue(
      rewrite.scope.column,
      80,
    )}:${safeLogValue(rewrite.userPhrase, 48)}->${safeLogValue(
      rewrite.canonicalValue,
      48,
    )}`;
    return rewrite.reason
      ? `${detail} (${safeLogValue(rewrite.reason, 80)})`
      : detail;
  });

  if (normalized.length <= limit) return normalized.join('; ');
  return `${normalized.slice(0, limit).join('; ')}; ...(+${
    normalized.length - limit
  } more)`;
};

const logDenodoGuard = (
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown>,
) => {
  const message = [
    event,
    ...Object.entries(fields).map(
      ([key, value]) => `${key}=${safeLogValue(value)}`,
    ),
  ].join(' ');

  switch (level) {
    case 'debug':
      logger.debug(message);
      break;
    case 'warn':
      logger.warn(message);
      break;
    case 'error':
      logger.error(message);
      break;
    default:
      logger.info(message);
  }
};

const getColumnIdentifier = (column: any): string | null => {
  if (typeof column === 'string' && column.trim()) {
    return column;
  }

  const quotedValue = column?.expr?.value;
  if (typeof quotedValue === 'string' && quotedValue.trim()) {
    return quotedValue;
  }

  if (typeof column?.value === 'string' && column.value.trim()) {
    return column.value;
  }

  return null;
};

const buildDenseRankReplacementExpr = ({
  sourceTableName,
  outerTableAlias,
  orderColumnName,
  operator,
  sourceAlias,
}: {
  sourceTableName: string;
  outerTableAlias: string;
  orderColumnName: string;
  operator: '>' | '<';
  sourceAlias: string;
}) => {
  const exprSql = `SELECT (SELECT COUNT(DISTINCT "${sourceAlias}"."${orderColumnName}") FROM "${sourceTableName}" AS "${sourceAlias}" WHERE "${sourceAlias}"."${orderColumnName}" ${operator} "${outerTableAlias}"."${orderColumnName}") + 1 AS "__denodo_rank" FROM "${sourceTableName}" AS "${outerTableAlias}"`;
  const exprAst = sqlParser.astify(exprSql, {
    database: 'postgresql',
  }) as any;

  return exprAst?.columns?.[0]?.expr || null;
};

const rewriteDenseRankForDenodo = (sql: string) => {
  if (!/DENSE_RANK\s*\(/i.test(sql)) {
    return {
      sql,
      appliedRewrites: [] as string[],
    };
  }

  try {
    const ast = sqlParser.astify(sql, {
      database: 'postgresql',
    }) as any;
    const appliedRewrites: string[] = [];
    let rewriteIndex = 0;

    const rewriteSelectStatement = (statement: any) => {
      if (!statement || statement.type !== 'select') return;

      (statement.with || []).forEach((cte: any) => {
        rewriteSelectStatement(cte?.stmt);
      });

      (statement.from || []).forEach((item: any) => {
        rewriteSelectStatement(item?.expr?.ast || item?.expr);
      });

      const fromItems = Array.isArray(statement.from) ? statement.from : [];
      if (fromItems.length !== 1) {
        return;
      }

      const fromItem = fromItems[0];
      if (fromItem?.join || fromItem?.expr?.ast || fromItem?.expr?.type === 'select') {
        return;
      }

      const sourceTableName =
        typeof fromItem?.table === 'string' ? fromItem.table : null;
      const outerTableAlias =
        typeof fromItem?.as === 'string' && fromItem.as.trim()
          ? fromItem.as
          : sourceTableName;

      if (!sourceTableName || !outerTableAlias) {
        return;
      }

      (statement.columns || []).forEach((column: any) => {
        const expr = column?.expr;
        if (
          !expr ||
          expr.type !== 'window_func' ||
          `${expr.name || ''}`.toUpperCase() !== 'DENSE_RANK'
        ) {
          return;
        }

        const specification =
          expr.over?.as_window_specification?.window_specification;
        const orderBy = specification?.orderby;
        if (
          !specification ||
          specification.partitionby ||
          !Array.isArray(orderBy) ||
          orderBy.length !== 1 ||
          specification.window_frame_clause
        ) {
          return;
        }

        const orderItem = orderBy[0];
        if (orderItem?.expr?.type !== 'column_ref') {
          return;
        }

        const orderColumnName = getColumnIdentifier(orderItem.expr.column);
        const orderTableName =
          typeof orderItem.expr.table === 'string' && orderItem.expr.table.trim()
            ? orderItem.expr.table
            : outerTableAlias;

        if (
          !orderColumnName ||
          ![outerTableAlias, sourceTableName].includes(orderTableName)
        ) {
          return;
        }

        const comparisonOperator =
          `${orderItem.type || 'ASC'}`.toUpperCase() === 'DESC' ? '>' : '<';
        rewriteIndex += 1;
        const rankSourceAlias = `${DENSE_RANK_SOURCE_ALIAS_PREFIX}_${rewriteIndex}`;
        const replacementExpr = buildDenseRankReplacementExpr({
          sourceTableName,
          outerTableAlias,
          orderColumnName,
          operator: comparisonOperator,
          sourceAlias: rankSourceAlias,
        });

        if (!replacementExpr) {
          return;
        }

        column.expr = replacementExpr;
        appliedRewrites.push(
          `rewrite dense_rank for denodo: ${outerTableAlias}.${orderColumnName} -> correlated subquery`,
        );
      });
    };

    if (Array.isArray(ast)) {
      ast.forEach((statement) => rewriteSelectStatement(statement));
    } else {
      rewriteSelectStatement(ast);
    }

    if (!appliedRewrites.length) {
      return { sql, appliedRewrites };
    }

    return {
      sql: sqlParser.sqlify(ast, { database: 'postgresql' }),
      appliedRewrites,
    };
  } catch {
    return {
      sql,
      appliedRewrites: [] as string[],
    };
  }
};

export interface GuardedDenodoSql {
  sql: string;
  sqlDialect: SQLDialect.DIALECT;
  toolCalls: string[];
  semanticFiles: string[];
  timingEvents: TimingEvent[];
}

export interface IDenodoSqlGuardService {
  guardAskResult(input: {
    askResult: AskResult;
    manifest: Manifest;
    project: Project;
  }): Promise<AskResult>;
  guardSql(input: {
    sql: string;
    manifest: Manifest;
    project: Project;
    retrievedTables?: string[];
    selectedModels?: AskResult['selectedModels'];
    normalizedQuery?: string;
    matchedRewrites?: AskResult['matchedRewrites'];
    traceId?: string;
    candidateIndex?: number;
  }): Promise<GuardedDenodoSql>;
}

export class DenodoSqlGuardService implements IDenodoSqlGuardService {
  private readonly denodoMcpAdaptor: IDenodoMcpAdaptor;
  private readonly wrenAIAdaptor: IWrenAIAdaptor;

  constructor({
    denodoMcpAdaptor,
    wrenAIAdaptor,
  }: {
    denodoMcpAdaptor: IDenodoMcpAdaptor;
    wrenAIAdaptor: IWrenAIAdaptor;
  }) {
    this.denodoMcpAdaptor = denodoMcpAdaptor;
    this.wrenAIAdaptor = wrenAIAdaptor;
  }

  public async guardAskResult({
    askResult,
    manifest,
    project,
  }: {
    askResult: AskResult;
    manifest: Manifest;
    project: Project;
  }): Promise<AskResult> {
    if (
      project.type !== DataSourceName.DENODO_MCP ||
      askResult.status !== AskResultStatus.FINISHED ||
      !askResult.response?.length
    ) {
      return askResult;
    }

    const toolCalls: string[] = [];
    const timingEvents: TimingEvent[] = [];
    const guardStartedAt = nowMs();
    const semanticFiles = this.getSemanticFiles(project.id);
    const validCandidates = [];
    let lastErrorMessage = '';
    let lastInvalidSql = '';
    logDenodoGuard('info', 'denodo_guard.start', {
      project_id: project.id,
      trace_id: askResult.traceId,
      candidate_sql_count: askResult.response.length,
      selected_models: formatSelectedModels(askResult.selectedModels),
      normalized_query: askResult.normalizedQuery,
      matched_rewrite_count: askResult.matchedRewrites?.length || 0,
      matched_rewrites: formatRewrites(askResult.matchedRewrites, 6),
    });

    for (let index = 0; index < askResult.response.length; index += 1) {
      const candidate = askResult.response[index];
      if (!candidate?.sql) continue;

      try {
        const guarded = await this.guardSql({
          sql: candidate.sql,
          manifest,
          project,
          retrievedTables: askResult.retrievedTables,
          selectedModels: askResult.selectedModels,
          normalizedQuery: askResult.normalizedQuery,
          matchedRewrites: askResult.matchedRewrites,
          traceId: askResult.traceId,
          candidateIndex: index + 1,
        });
        toolCalls.push(
          ...this.prefixCandidateToolCalls(guarded.toolCalls, index, askResult),
        );
        timingEvents.push(...guarded.timingEvents);
        validCandidates.push({
          ...candidate,
          sql: guarded.sql,
          sqlDialect: guarded.sqlDialect,
        });
      } catch (error: any) {
        toolCalls.push(
          ...this.prefixCandidateToolCalls(
            error?.extensions?.other?.toolCalls || [],
            index,
            askResult,
          ),
        );
        timingEvents.push(...(error?.extensions?.other?.timingEvents || []));
        lastErrorMessage = error?.message || 'Failed to validate Denodo SQL';
        lastInvalidSql =
          error?.extensions?.other?.invalidSql ||
          error?.extensions?.other?.sql ||
          candidate.sql;
        logDenodoGuard('warn', 'denodo_guard.candidate_failed', {
          project_id: project.id,
          trace_id: askResult.traceId,
          candidate_index: index + 1,
          error: lastErrorMessage,
        });
      }
    }

    if (!validCandidates.length) {
      timingEvents.push(
        createTimingStep('denodo.guard_total', guardStartedAt, {
          validCandidateCount: 0,
          failedCandidateCount: askResult.response.length,
        }),
      );
      logDenodoGuard('error', 'denodo_guard.final_result', {
        project_id: project.id,
        trace_id: askResult.traceId,
        valid_candidate_count: 0,
        failed_candidate_count: askResult.response.length,
        invalid_sql_present: !!lastInvalidSql,
        error: lastErrorMessage || 'Failed to validate Denodo SQL',
      });
      return {
        ...askResult,
        status: AskResultStatus.FAILED,
        response: [],
        error: {
          code: Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
          message: lastErrorMessage || 'Failed to validate Denodo SQL',
        },
        toolCalls,
        semanticFiles,
        timingEvents: [...(askResult.timingEvents || []), ...timingEvents],
        invalidSql: lastInvalidSql,
      };
    }

    timingEvents.push(
      createTimingStep('denodo.guard_total', guardStartedAt, {
        validCandidateCount: validCandidates.length,
        failedCandidateCount: askResult.response.length - validCandidates.length,
      }),
    );
    logDenodoGuard('info', 'denodo_guard.final_result', {
      project_id: project.id,
      trace_id: askResult.traceId,
      valid_candidate_count: validCandidates.length,
      failed_candidate_count: askResult.response.length - validCandidates.length,
      invalid_sql_present: !!lastInvalidSql,
    });
    return {
      ...askResult,
      response: validCandidates,
      toolCalls,
      semanticFiles,
      timingEvents: [...(askResult.timingEvents || []), ...timingEvents],
    };
  }

  public async guardSql({
    sql,
    manifest,
    project,
    retrievedTables,
    selectedModels,
    normalizedQuery,
    matchedRewrites,
    traceId,
    candidateIndex,
  }: {
    sql: string;
    manifest: Manifest;
    project: Project;
    retrievedTables?: string[];
    selectedModels?: AskResult['selectedModels'];
    normalizedQuery?: string;
    matchedRewrites?: AskResult['matchedRewrites'];
    traceId?: string;
    candidateIndex?: number;
  }): Promise<GuardedDenodoSql> {
    const semanticFiles = this.getSemanticFiles(project.id);
    const toolCalls: string[] = [];
    const timingEvents: TimingEvent[] = [];
    const connectionInfo = toIbisConnectionInfo(
      project.type,
      project.connectionInfo,
    ) as DENODO_MCP_CONNECTION_INFO;
    const validateToolName = buildDenodoMcpValidateToolName(
      connectionInfo.databaseName,
    );

    let attempt = 1;
    const toNativeStartedAt = nowMs();
    let currentSql = toDenodoNativeSql(sql, manifest);
    timingEvents.push(
      createTimingStep('denodo.to_native_sql', toNativeStartedAt, {
        candidateIndex,
      }),
    );
    let lastErrorMessage = '';
    const selectedModelNames = selectedModels
      ? [
          selectedModels.primaryModel,
          ...(selectedModels.secondaryModels || []),
        ]
      : [];
    const correctionContextModels = selectedModelNames.length
      ? selectedModelNames
      : retrievedTables || [];
    const correctionContextSource = selectedModelNames.length
      ? 'selected_models'
      : 'retrieved_tables';
    const dictionaryReadStartedAt = nowMs();
    const semanticDictionary = isDenodoSemanticDictionaryEnabled()
      ? await readDenodoSemanticDictionary(project.id)
      : null;
    if (isDenodoSemanticDictionaryEnabled()) {
      timingEvents.push(
        createTimingStep('denodo.semantic_dictionary_read', dictionaryReadStartedAt, {
          candidateIndex,
          enabled: true,
          entryCount: semanticDictionary?.entries?.length || 0,
        }),
      );
    }
    const dictionarySemanticContext =
      semanticDictionary && isDenodoSemanticDictionaryEnabled()
        ? toDenodoSemanticContext(semanticDictionary, {
            models: selectedModelNames.length
              ? selectedModelNames
              : retrievedTables,
          })
        : undefined;
    const semanticContext = buildDenodoAiSemanticContext(
      dictionarySemanticContext,
    );

    while (attempt <= MAX_VALIDATE_ATTEMPTS) {
      let semanticSqlRewriteCount = 0;
      if (semanticDictionary) {
        const semanticRewriteStartedAt = nowMs();
        const semanticRewrite = applySemanticDictionaryToSql(
          currentSql,
          manifest,
          semanticDictionary,
        );
        currentSql = semanticRewrite.sql;
        toolCalls.push(...semanticRewrite.appliedRewrites);
        semanticSqlRewriteCount = semanticRewrite.appliedRewrites.length;
        timingEvents.push(
          createTimingStep('denodo.semantic_rewrite', semanticRewriteStartedAt, {
            candidateIndex,
            attempt,
            rewriteCount: semanticSqlRewriteCount,
          }),
        );
      }
      const denseRankRewriteStartedAt = nowMs();
      const denseRankRewrite = rewriteDenseRankForDenodo(currentSql);
      currentSql = denseRankRewrite.sql;
      toolCalls.push(...denseRankRewrite.appliedRewrites);
      timingEvents.push(
        createTimingStep('denodo.dense_rank_rewrite', denseRankRewriteStartedAt, {
          candidateIndex,
          attempt,
          rewriteCount: denseRankRewrite.appliedRewrites.length,
        }),
      );
      logDenodoGuard('info', 'denodo_guard.validate_attempt', {
        project_id: project.id,
        trace_id: traceId,
        candidate_index: candidateIndex,
        attempt,
        selected_models: formatSelectedModels(selectedModels),
        normalized_query: normalizedQuery,
        matched_rewrite_count: matchedRewrites?.length || 0,
        semantic_sql_rewrite_applied: semanticSqlRewriteCount > 0,
        semantic_sql_rewrite_count: semanticSqlRewriteCount,
      });
      toolCalls.push(`call MCP tool: ${validateToolName} (attempt ${attempt})`);
      const validateStartedAt = nowMs();
      const validation = await this.denodoMcpAdaptor.validateSqlQuery(
        currentSql,
        connectionInfo,
      );
      timingEvents.push(
        createTimingStep(`denodo.validate_attempt_${attempt}`, validateStartedAt, {
          candidateIndex,
          isValid: validation.isValid,
        }),
      );

      if (validation.isValid) {
        toolCalls.push('validate succeeded');
        logDenodoGuard('info', 'denodo_guard.validate_result', {
          project_id: project.id,
          trace_id: traceId,
          candidate_index: candidateIndex,
          attempt,
          is_valid: true,
          error: LOG_EMPTY_VALUE,
        });
        return {
          sql: currentSql,
          sqlDialect: SQLDialect.DIALECT,
          toolCalls,
          semanticFiles,
          timingEvents,
        };
      }

      lastErrorMessage = validation.errorMessage || 'Unknown validation error';
      toolCalls.push(`validate failed: ${lastErrorMessage}`);
      logDenodoGuard('warn', 'denodo_guard.validate_result', {
        project_id: project.id,
        trace_id: traceId,
        candidate_index: candidateIndex,
        attempt,
        is_valid: false,
        error: lastErrorMessage,
      });

      if (attempt >= MAX_VALIDATE_ATTEMPTS) {
        break;
      }

      logDenodoGuard('info', 'denodo_guard.correction_start', {
        project_id: project.id,
        trace_id: traceId,
        candidate_index: candidateIndex,
        attempt,
        error: lastErrorMessage,
        context_source: correctionContextSource,
        context_models: formatList(correctionContextModels, 8),
        normalized_query: normalizedQuery,
        matched_rewrite_count: matchedRewrites?.length || 0,
      });
      toolCalls.push(`call AI service: sql_correction (attempt ${attempt})`);
      const correctionCreateStartedAt = nowMs();
      const correctionTask = await this.wrenAIAdaptor.createSqlCorrection({
        sql: currentSql,
        error: lastErrorMessage,
        projectId: project.id.toString(),
        retrievedTables: correctionContextModels,
        validationMode: 'none',
        semanticContext,
        normalizedQuery,
        selectedModels,
        matchedRewrites,
      });
      timingEvents.push(
        createTimingStep(
          `denodo.sql_correction_create_${attempt}`,
          correctionCreateStartedAt,
          { candidateIndex, correctionQueryId: correctionTask.queryId },
        ),
      );
      let correctionResult: SqlCorrectionResult;
      const correctionWaitStartedAt = nowMs();
      try {
        correctionResult = await this.waitSqlCorrection(correctionTask.queryId);
        timingEvents.push(
          createTimingStep(
            `denodo.sql_correction_wait_${attempt}`,
            correctionWaitStartedAt,
            {
              candidateIndex,
              correctionQueryId: correctionTask.queryId,
              status: correctionResult.status,
            },
          ),
        );
      } catch (error: any) {
        timingEvents.push(
          createTimingStep(
            `denodo.sql_correction_wait_${attempt}`,
            correctionWaitStartedAt,
            {
              candidateIndex,
              correctionQueryId: correctionTask.queryId,
              status: 'TIMEOUT',
            },
          ),
        );
        logDenodoGuard('warn', 'denodo_guard.correction_result', {
          project_id: project.id,
          trace_id: traceId,
          candidate_index: candidateIndex,
          attempt,
          correction_query_id: correctionTask.queryId,
          correction_status: 'TIMEOUT',
          sql_changed: false,
          error: error?.message || 'Timed out waiting for SQL correction result',
        });
        throw error;
      }
      logDenodoGuard(
        correctionResult.status === SqlCorrectionStatus.FINISHED
          ? 'info'
          : 'warn',
        'denodo_guard.correction_result',
        {
          project_id: project.id,
          trace_id: correctionResult.traceId || traceId,
          candidate_index: candidateIndex,
          attempt,
          correction_query_id: correctionTask.queryId,
          correction_status: correctionResult.status,
          sql_changed: correctionResult.response
            ? correctionResult.response !== currentSql
            : false,
          error: correctionResult.error?.message,
        },
      );

      if (
        correctionResult.status !== SqlCorrectionStatus.FINISHED ||
        !correctionResult.response
      ) {
        lastErrorMessage =
          correctionResult.error?.message ||
          lastErrorMessage ||
          'SQL correction failed';
        toolCalls.push(`sql_correction failed: ${lastErrorMessage}`);
        break;
      }

      currentSql = correctionResult.response;
      attempt += 1;
    }

    throw Errors.create(Errors.GeneralErrorCodes.INVALID_SQL_ERROR, {
      customMessage: lastErrorMessage || 'Failed to validate Denodo SQL',
      other: {
        invalidSql: currentSql,
        toolCalls,
        semanticFiles,
        timingEvents,
      },
    });
  }

  private async waitSqlCorrection(queryId: string) {
    let retries = 0;
    let result = await this.wrenAIAdaptor.getSqlCorrectionResult(queryId);

    while (
      result.status === SqlCorrectionStatus.CORRECTING &&
      retries < MAX_CORRECTION_POLLS
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, CORRECTION_POLL_INTERVAL),
      );
      result = await this.wrenAIAdaptor.getSqlCorrectionResult(queryId);
      retries += 1;
    }

    if (result.status === SqlCorrectionStatus.CORRECTING) {
      throw Errors.create(Errors.GeneralErrorCodes.POLLING_TIMEOUT, {
        customMessage: `Timed out waiting for SQL correction result: ${queryId}`,
      });
    }

    return result;
  }

  private getSemanticFiles(projectId: number) {
    const files = [
      `read semantic file: ${getDenodoRawSchemaPath(projectId)}`,
      `read semantic file: ${getDenodoManifestPath(projectId)}`,
    ];
    if (isDenodoSemanticDictionaryEnabled()) {
      files.push(
        `read semantic file: ${getDenodoSemanticDictionaryPath(projectId)}`,
      );
    }
    return files;
  }

  private prefixCandidateToolCalls(
    toolCalls: string[],
    index: number,
    askResult: AskResult,
  ) {
    if ((askResult.response?.length || 0) <= 1) {
      return toolCalls;
    }

    const candidateNumber = index + 1;
    return toolCalls.map((item) => `[candidate ${candidateNumber}] ${item}`);
  }
}
