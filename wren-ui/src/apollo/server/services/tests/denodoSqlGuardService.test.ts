import { DataSourceName } from '@server/types';
import { encryptConnectionInfo } from '@server/dataSource';
import {
  AskCandidateType,
  AskResultStatus,
  SqlCorrectionStatus,
} from '@server/models/adaptor';
import * as denodoMcpUtils from '@server/utils/denodoMcp';
import { DenodoSqlGuardService } from '../denodoSqlGuardService';

describe('DenodoSqlGuardService', () => {
  const originalEnableSemanticDictionary =
    process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY;

  const manifest = {
    models: [
      {
        name: 'dv_order_base',
        cached: false,
        tableReference: {
          table: 'dv_order_base',
        },
        columns: [
          {
            name: 'city',
            isCalculated: false,
            expression: '"city"',
          },
        ],
      },
    ],
  } as any;

  const project = {
    id: 7,
    type: DataSourceName.DENODO_MCP,
    connectionInfo: {
      baseUrl: 'http://example.test/mcp',
      databaseName: 'admin',
      username: 'user',
      password: 'password',
    },
  } as any;

  const encryptedProject = {
    ...project,
    connectionInfo: encryptConnectionInfo(
      DataSourceName.DENODO_MCP,
      project.connectionInfo,
    ),
  } as any;

  afterEach(() => {
    process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY =
      originalEnableSemanticDictionary;
    jest.restoreAllMocks();
  });

  it('returns translated Denodo SQL when first validation succeeds', async () => {
    const denodoMcpAdaptor = {
      validateSqlQuery: jest.fn().mockResolvedValue({ isValid: true }),
    };
    const wrenAIAdaptor = {
      createSqlCorrection: jest.fn(),
      getSqlCorrectionResult: jest.fn(),
    };
    const service = new DenodoSqlGuardService({
      denodoMcpAdaptor: denodoMcpAdaptor as any,
      wrenAIAdaptor: wrenAIAdaptor as any,
    });

    const result = await service.guardAskResult({
      askResult: {
        status: AskResultStatus.FINISHED,
        type: 'TEXT_TO_SQL',
        error: null,
        response: [
          {
            type: AskCandidateType.LLM,
            sql: 'SELECT city FROM dv_order_base',
          },
        ],
      } as any,
      manifest,
      project: encryptedProject,
    });

    expect(result.response?.[0]?.sql).toContain('SELECT "city"');
    expect(result.response?.[0]?.sql).toContain('FROM "dv_order_base"');
    expect(result.response?.[0]?.sqlDialect).toBe('DIALECT');
    expect(denodoMcpAdaptor.validateSqlQuery).toHaveBeenCalledTimes(1);
  });

  it('decrypts denodo mcp password before validate call', async () => {
    const denodoMcpAdaptor = {
      validateSqlQuery: jest.fn().mockResolvedValue({ isValid: true }),
    };
    const wrenAIAdaptor = {
      createSqlCorrection: jest.fn(),
      getSqlCorrectionResult: jest.fn(),
    };
    const service = new DenodoSqlGuardService({
      denodoMcpAdaptor: denodoMcpAdaptor as any,
      wrenAIAdaptor: wrenAIAdaptor as any,
    });

    await service.guardAskResult({
      askResult: {
        status: AskResultStatus.FINISHED,
        type: 'TEXT_TO_SQL',
        error: null,
        response: [
          {
            type: AskCandidateType.LLM,
            sql: 'SELECT city FROM dv_order_base',
          },
        ],
      } as any,
      manifest,
      project: encryptedProject,
    });

    expect(denodoMcpAdaptor.validateSqlQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        username: 'user',
        password: 'password',
      }),
    );
  });

  it('retries with sql correction when validation fails once', async () => {
    const denodoMcpAdaptor = {
      validateSqlQuery: jest
        .fn()
        .mockResolvedValueOnce({
          isValid: false,
          errorMessage: "View 'dv_order_base' not found",
        })
        .mockResolvedValueOnce({
          isValid: true,
        }),
    };
    const wrenAIAdaptor = {
      createSqlCorrection: jest.fn().mockResolvedValue({ queryId: 'c-1' }),
      getSqlCorrectionResult: jest.fn().mockResolvedValue({
        status: SqlCorrectionStatus.FINISHED,
        response: 'SELECT "city" FROM "dv_order_base"',
      }),
    };
    const service = new DenodoSqlGuardService({
      denodoMcpAdaptor: denodoMcpAdaptor as any,
      wrenAIAdaptor: wrenAIAdaptor as any,
    });

    const result = await service.guardAskResult({
      askResult: {
        status: AskResultStatus.FINISHED,
        type: 'TEXT_TO_SQL',
        error: null,
        response: [
          {
            type: AskCandidateType.LLM,
            sql: 'SELECT city FROM dv_order_base',
          },
        ],
        retrievedTables: ['dv_order_base'],
      } as any,
      manifest,
      project: encryptedProject,
    });

    expect(wrenAIAdaptor.createSqlCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        validationMode: 'none',
        projectId: '7',
        retrievedTables: ['dv_order_base'],
      }),
    );
    expect(denodoMcpAdaptor.validateSqlQuery).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        'call MCP tool: denodo_admin_validate_sql_query (attempt 1)',
        "validate failed: View 'dv_order_base' not found",
        'call AI service: sql_correction (attempt 1)',
        'call MCP tool: denodo_admin_validate_sql_query (attempt 2)',
        'validate succeeded',
      ]),
    );
  });

  it('applies semantic dictionary rewrite before validation', async () => {
    process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY = 'true';

    jest
      .spyOn(denodoMcpUtils, 'readDenodoSemanticDictionary')
      .mockResolvedValue(
        denodoMcpUtils.buildDenodoSemanticDictionary([
          {
            scope: {
              model: 'dv_order_base',
              column: 'city',
            },
            aliases: ['魔都'],
            canonicalValue: '上海',
          },
        ]),
      );

    const denodoMcpAdaptor = {
      validateSqlQuery: jest.fn().mockResolvedValue({ isValid: true }),
    };
    const wrenAIAdaptor = {
      createSqlCorrection: jest.fn(),
      getSqlCorrectionResult: jest.fn(),
    };
    const service = new DenodoSqlGuardService({
      denodoMcpAdaptor: denodoMcpAdaptor as any,
      wrenAIAdaptor: wrenAIAdaptor as any,
    });

    const result = await service.guardAskResult({
      askResult: {
        status: AskResultStatus.FINISHED,
        type: 'TEXT_TO_SQL',
        error: null,
        response: [
          {
            type: AskCandidateType.LLM,
            sql: `SELECT city FROM dv_order_base WHERE lower(city) LIKE lower('%魔都%')`,
          },
        ],
        retrievedTables: ['dv_order_base'],
      } as any,
      manifest,
      project: encryptedProject,
    });

    expect(denodoMcpAdaptor.validateSqlQuery).toHaveBeenCalledWith(
      expect.stringContaining(`= '上海'`),
      expect.any(Object),
    );
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        'apply semantic rewrite: dv_order_base.city: 魔都 -> 上海',
        'call MCP tool: denodo_admin_validate_sql_query (attempt 1)',
        'validate succeeded',
      ]),
    );
    expect(result.semanticFiles).toEqual(
      expect.arrayContaining([
        expect.stringContaining('semantic-dictionary.json'),
      ]),
    );
  });

  it('passes semantic context into sql correction retries', async () => {
    process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY = 'true';

    jest
      .spyOn(denodoMcpUtils, 'readDenodoSemanticDictionary')
      .mockResolvedValue(
        denodoMcpUtils.buildDenodoSemanticDictionary([
          {
            scope: {
              model: 'dv_order_base',
              column: 'city',
            },
            aliases: ['魔都'],
            canonicalValue: '上海',
          },
        ]),
      );

    const denodoMcpAdaptor = {
      validateSqlQuery: jest
        .fn()
        .mockResolvedValueOnce({
          isValid: false,
          errorMessage: 'Validation failed',
        })
        .mockResolvedValueOnce({ isValid: true }),
    };
    const wrenAIAdaptor = {
      createSqlCorrection: jest.fn().mockResolvedValue({ queryId: 'c-1' }),
      getSqlCorrectionResult: jest.fn().mockResolvedValue({
        status: SqlCorrectionStatus.FINISHED,
        response: `SELECT "city" FROM "dv_order_base" WHERE "city" = '上海'`,
      }),
    };
    const service = new DenodoSqlGuardService({
      denodoMcpAdaptor: denodoMcpAdaptor as any,
      wrenAIAdaptor: wrenAIAdaptor as any,
    });

    await service.guardAskResult({
      askResult: {
        status: AskResultStatus.FINISHED,
        type: 'TEXT_TO_SQL',
        error: null,
        response: [
          {
            type: AskCandidateType.LLM,
            sql: `SELECT city FROM dv_order_base WHERE lower(city) LIKE lower('%魔都%')`,
          },
        ],
        retrievedTables: ['dv_order_base'],
      } as any,
      manifest,
      project: encryptedProject,
    });

    expect(wrenAIAdaptor.createSqlCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        semanticContext: expect.stringContaining('scope: dv_order_base.city'),
      }),
    );
  });
});
