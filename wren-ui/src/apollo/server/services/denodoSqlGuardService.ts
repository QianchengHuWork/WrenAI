import { IDenodoMcpAdaptor, IWrenAIAdaptor } from '@server/adaptors';
import { Manifest } from '@server/mdl/type';
import { DataSourceName } from '@server/types';
import {
  AskResult,
  AskResultStatus,
  SQLDialect,
  SqlCorrectionStatus,
} from '@server/models/adaptor';
import {
  DENODO_MCP_CONNECTION_INFO,
  Project,
} from '@server/repositories';
import { toIbisConnectionInfo } from '@server/dataSource';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import {
  buildDenodoMcpValidateToolName,
  getDenodoManifestPath,
  getDenodoRawSchemaPath,
  toDenodoNativeSql,
} from '@server/utils/denodoMcp';

const logger = getLogger('DenodoSqlGuardService');
logger.level = 'debug';

const MAX_VALIDATE_ATTEMPTS = 3;
const MAX_CORRECTION_POLLS = 60;
const CORRECTION_POLL_INTERVAL = 1000;

export interface GuardedDenodoSql {
  sql: string;
  sqlDialect: SQLDialect.DIALECT;
  toolCalls: string[];
  semanticFiles: string[];
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
    const semanticFiles = this.getSemanticFiles(project.id);
    const validCandidates = [];
    let lastErrorMessage = '';
    let lastInvalidSql = '';

    for (let index = 0; index < askResult.response.length; index += 1) {
      const candidate = askResult.response[index];
      if (!candidate?.sql) continue;

      try {
        const guarded = await this.guardSql({
          sql: candidate.sql,
          manifest,
          project,
          retrievedTables: askResult.retrievedTables,
        });
        toolCalls.push(
          ...this.prefixCandidateToolCalls(guarded.toolCalls, index, askResult),
        );
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
        lastErrorMessage = error?.message || 'Failed to validate Denodo SQL';
        lastInvalidSql =
          error?.extensions?.other?.invalidSql ||
          error?.extensions?.other?.sql ||
          candidate.sql;
      }
    }

    if (!validCandidates.length) {
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
        invalidSql: lastInvalidSql,
      };
    }

    return {
      ...askResult,
      response: validCandidates,
      toolCalls,
      semanticFiles,
    };
  }

  public async guardSql({
    sql,
    manifest,
    project,
    retrievedTables,
  }: {
    sql: string;
    manifest: Manifest;
    project: Project;
    retrievedTables?: string[];
  }): Promise<GuardedDenodoSql> {
    const semanticFiles = this.getSemanticFiles(project.id);
    const toolCalls: string[] = [];
    const connectionInfo = toIbisConnectionInfo(
      project.type,
      project.connectionInfo,
    ) as DENODO_MCP_CONNECTION_INFO;
    const validateToolName = buildDenodoMcpValidateToolName(
      connectionInfo.databaseName,
    );

    let attempt = 1;
    let currentSql = toDenodoNativeSql(sql, manifest);
    let lastErrorMessage = '';

    while (attempt <= MAX_VALIDATE_ATTEMPTS) {
      logger.debug(
        `Validating Denodo SQL. projectId=${project.id}, attempt=${attempt}`,
      );
      toolCalls.push(`call MCP tool: ${validateToolName} (attempt ${attempt})`);
      const validation = await this.denodoMcpAdaptor.validateSqlQuery(
        currentSql,
        connectionInfo,
      );

      if (validation.isValid) {
        toolCalls.push('validate succeeded');
        return {
          sql: currentSql,
          sqlDialect: SQLDialect.DIALECT,
          toolCalls,
          semanticFiles,
        };
      }

      lastErrorMessage = validation.errorMessage || 'Unknown validation error';
      toolCalls.push(`validate failed: ${lastErrorMessage}`);

      if (attempt >= MAX_VALIDATE_ATTEMPTS) {
        break;
      }

      toolCalls.push(`call AI service: sql_correction (attempt ${attempt})`);
      const correctionTask = await this.wrenAIAdaptor.createSqlCorrection({
        sql: currentSql,
        error: lastErrorMessage,
        projectId: project.id.toString(),
        retrievedTables,
        validationMode: 'none',
      });
      const correctionResult = await this.waitSqlCorrection(correctionTask.queryId);

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
    return [
      `read semantic file: ${getDenodoRawSchemaPath(projectId)}`,
      `read semantic file: ${getDenodoManifestPath(projectId)}`,
    ];
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
