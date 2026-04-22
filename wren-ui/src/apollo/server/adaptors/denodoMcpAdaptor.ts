import axios, { AxiosResponse } from 'axios';
import { getConfig } from '@server/config';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import { DENODO_MCP_CONNECTION_INFO } from '@server/repositories';
import {
  buildDenodoDataCatalogBaseUrl,
  buildDenodoDataCatalogUri,
  buildDenodoMcpQueryToolName,
  buildDenodoMcpSchemaToolName,
  buildDenodoMcpValidateToolName,
  DenodoViewAssociation,
  extractDenodoStructuredContent,
} from '@server/utils/denodoMcp';

const logger = getLogger('DenodoMcpAdaptor');
logger.level = 'debug';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const SESSION_HEADER = 'Mcp-Session-Id';

type JsonRpcPayload = {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
};

export interface IDenodoMcpAdaptor {
  getDatabaseSchema(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
  ): Promise<Record<string, any>>;
  getViewAssociations(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
    viewName: string,
  ): Promise<DenodoViewAssociation[]>;
  validateSqlQuery(
    sql: string,
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
  ): Promise<{ isValid: boolean; errorMessage?: string }>;
  runSqlQuery(
    sql: string,
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
  ): Promise<Record<string, any>>;
}

export class DenodoMcpAdaptor implements IDenodoMcpAdaptor {
  private readonly timeout = 30000;
  private readonly config = getConfig();

  public async getDatabaseSchema(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
  ): Promise<Record<string, any>> {
    return this.callTool(
      connectionInfo,
      buildDenodoMcpSchemaToolName(connectionInfo.databaseName),
      {},
    );
  }

  public async runSqlQuery(
    sql: string,
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
  ): Promise<Record<string, any>> {
    return this.callTool(
      connectionInfo,
      buildDenodoMcpQueryToolName(connectionInfo.databaseName),
      { sql_query: sql },
    );
  }

  public async getViewAssociations(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
    viewName: string,
  ): Promise<DenodoViewAssociation[]> {
    const endpoint = `${buildDenodoDataCatalogBaseUrl(
      connectionInfo.baseUrl,
    )}/views/associations`;
    const response = await axios.get(endpoint, {
      headers: this.buildDataCatalogHeaders(connectionInfo),
      timeout: this.timeout,
      params: {
        databaseName: connectionInfo.databaseName,
        viewName,
        uri: buildDenodoDataCatalogUri(connectionInfo.baseUrl),
        serverId: 1,
      },
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      throw new Error(
        `Error fetching Denodo associations for view "${viewName}" (HTTP ${response.status}): ${JSON.stringify(response.data)}`,
      );
    }

    if (Array.isArray(response.data)) {
      return response.data as DenodoViewAssociation[];
    }

    if (Array.isArray(response.data?.associations)) {
      return response.data.associations as DenodoViewAssociation[];
    }

    return [];
  }

  public async validateSqlQuery(
    sql: string,
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
  ): Promise<{ isValid: boolean; errorMessage?: string }> {
    const result = await this.callTool(
      connectionInfo,
      buildDenodoMcpValidateToolName(connectionInfo.databaseName),
      { sql_query: sql },
    );
    const structured = extractDenodoStructuredContent<{
      is_valid?: boolean;
      error_message?: string;
    }>(result);
    return {
      isValid: structured?.is_valid === true,
      errorMessage: structured?.error_message,
    };
  }

  private async callTool(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
    toolName: string,
    argumentsPayload: Record<string, any>,
  ) {
    const execute = async (sessionId?: string) => {
      const requestId = this.createRequestId();
      const response = await this.postJsonRpc(
        connectionInfo,
        {
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: argumentsPayload,
          },
        },
        sessionId,
      );
      const payload = this.parseJsonRpcResponse(response, requestId);
      if (payload?.error) {
        throw Errors.create(Errors.GeneralErrorCodes.SQL_EXECUTION_ERROR, {
          customMessage: payload.error.message,
          other: payload.error.data,
        });
      }
      if (payload?.result?.isError) {
        throw Errors.create(Errors.GeneralErrorCodes.SQL_EXECUTION_ERROR, {
          customMessage: this.getToolErrorMessage(payload.result),
          other: payload.result,
        });
      }
      return payload?.result || {};
    };

    let sessionId = await this.initializeSession(connectionInfo);
    try {
      return await execute(sessionId);
    } catch (error: any) {
      if (error?.response?.status === 404 && sessionId) {
        logger.warn(`Denodo MCP session expired, retrying with a new session`);
        sessionId = await this.initializeSession(connectionInfo);
        return await execute(sessionId);
      }
      throw error;
    } finally {
      await this.closeSession(connectionInfo, sessionId);
    }
  }

  private async initializeSession(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
  ): Promise<string | undefined> {
    const requestId = this.createRequestId();
    const response = await this.postJsonRpc(connectionInfo, {
      jsonrpc: '2.0',
      id: requestId,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'wren-ui',
          version: this.config.wrenUIVersion || '0.32.2',
        },
      },
    });
    this.parseJsonRpcResponse(response, requestId);

    const sessionId =
      response.headers['mcp-session-id'] || response.headers['Mcp-Session-Id'];

    await this.postJsonRpc(
      connectionInfo,
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      },
      sessionId,
    );

    return sessionId;
  }

  private async closeSession(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
    sessionId?: string,
  ) {
    if (!sessionId) return;

    try {
      await axios.delete(connectionInfo.baseUrl, {
        headers: this.buildHeaders(connectionInfo, sessionId),
        timeout: this.timeout,
        validateStatus: () => true,
      });
    } catch (error: any) {
      logger.debug(`Ignore MCP session close error: ${error.message}`);
    }
  }

  private async postJsonRpc(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
    payload: JsonRpcPayload,
    sessionId?: string,
  ) {
    const response = await axios.post(connectionInfo.baseUrl, payload, {
      headers: this.buildHeaders(connectionInfo, sessionId),
      timeout: this.timeout,
      responseType: 'text',
      transformResponse: [(data) => data],
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      const error = new Error(
        `Error POSTing to endpoint (HTTP ${response.status}): ${response.data}`,
      ) as Error & { response?: AxiosResponse<string> };
      error.response = response;
      throw error;
    }

    return response;
  }

  private parseJsonRpcResponse(
    response: AxiosResponse<string>,
    requestId: string,
  ) {
    if (!response.data) return null;

    const contentType = `${response.headers['content-type'] || ''}`;
    const payloads = contentType.includes('text/event-stream')
      ? this.parseSsePayload(response.data)
      : [JSON.parse(response.data)];

    return (
      payloads.find((payload) => `${payload?.id}` === `${requestId}`) ||
      payloads[0]
    );
  }

  private parseSsePayload(raw: string) {
    return raw
      .split('\n\n')
      .map((chunk) =>
        chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.replace(/^data:\s?/, ''))
          .join('\n'),
      )
      .filter(Boolean)
      .map((json) => JSON.parse(json));
  }

  private buildHeaders(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
    sessionId?: string,
  ) {
    return {
      ...this.buildDataCatalogHeaders(connectionInfo),
      'Content-Type': 'application/json',
      ...(sessionId ? { [SESSION_HEADER]: sessionId } : {}),
    };
  }

  private buildDataCatalogHeaders(
    connectionInfo: DENODO_MCP_CONNECTION_INFO,
  ) {
    const authorization = Buffer.from(
      `${connectionInfo.username}:${connectionInfo.password}`,
    ).toString('base64');

    return {
      Accept: 'application/json, text/event-stream',
      Authorization: `Basic ${authorization}`,
    };
  }

  private createRequestId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private getToolErrorMessage(result: Record<string, any>) {
    return (
      result?.content?.find(
        (item) => item?.type === 'text' && typeof item?.text === 'string',
      )?.text || 'Denodo MCP tool execution failed'
    );
  }
}
