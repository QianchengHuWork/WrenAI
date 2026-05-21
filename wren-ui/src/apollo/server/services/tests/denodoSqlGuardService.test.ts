import { DataSourceName } from '@server/types';
import { encryptConnectionInfo } from '@server/dataSource';
import {
  AskCandidateType,
  AskResultStatus,
  SQLDialect,
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
    if (originalEnableSemanticDictionary === undefined) {
      delete process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY;
    } else {
      process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY =
        originalEnableSemanticDictionary;
    }
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
    expect(result.timingEvents?.map((event) => event.name)).toEqual(
      expect.arrayContaining([
        'denodo.to_native_sql',
        'denodo.validate_attempt_1',
        'denodo.guard_total',
      ]),
    );
    expect(result.sqlTraceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'denodo_guard',
          stage: 'denodo_guard_validate_attempt',
          attempt: 1,
          status: 'VALID',
          candidateSql: 'SELECT city FROM dv_order_base',
          validateSql: expect.stringContaining('FROM "dv_order_base"'),
        }),
      ]),
    );
  });

  it('validates dialect SQL directly without converting through manifest', async () => {
    const mappedManifest = {
      models: [
        {
          name: 'logical_order',
          cached: false,
          tableReference: {
            table: 'physical_order',
          },
          columns: [
            {
              name: 'city',
              isCalculated: false,
              expression: '"physical_city"',
            },
          ],
        },
      ],
    } as any;
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
            sql: 'SELECT "city" FROM "logical_order"',
            sqlDialect: SQLDialect.DIALECT,
          },
        ],
      } as any,
      manifest: mappedManifest,
      project: encryptedProject,
    });

    expect(denodoMcpAdaptor.validateSqlQuery).toHaveBeenCalledWith(
      'SELECT "city" FROM "logical_order"',
      expect.any(Object),
    );
    expect(result.response?.[0]?.sql).toBe(
      'SELECT "city" FROM "logical_order"',
    );
    expect(result.timingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'denodo.to_native_sql',
          metadata: expect.objectContaining({
            alreadyDialectSql: true,
          }),
        }),
      ]),
    );
  });

  it('sanitizes dialect SQL expressions before validation', async () => {
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
            sql: 'SELECT AVG(TO_NUMBER("dv_package_order_core"."package_price")) AS "avg_price_increase" FROM "dv_package_order_core"',
            sqlDialect: SQLDialect.DIALECT,
          },
        ],
      } as any,
      manifest,
      project: encryptedProject,
    });

    expect(denodoMcpAdaptor.validateSqlQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        'AVG(CAST("dv_package_order_core"."package_price" AS DECIMAL(18, 2))) AS "avg_price_increase"',
      ),
      expect.any(Object),
    );
    expect(result.response?.[0]?.sql).not.toContain('TO_NUMBER');
    expect(result.response?.[0]?.sqlDialect).toBe(SQLDialect.DIALECT);
  });

  it('removes unavailable Denodo partition filters before validation', async () => {
    const cityManifest = {
      models: [
        {
          name: 'dm_ord_month_city',
          cached: false,
          tableReference: {
            table: 'dm_ord_month_city',
          },
          columns: [
            {
              name: 'order_year_month',
              isCalculated: false,
              expression: '"order_year_month"',
            },
            {
              name: 'city_code',
              isCalculated: false,
              expression: '"city_code"',
            },
          ],
        },
      ],
    } as any;
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
            sql: `SELECT "city_code"
              FROM "dm_ord_month_city"
              WHERE "order_year_month" >= '202506'
                AND "ptstart" >= '20250601'
                AND "ptend" <= '20260531'`,
            sqlDialect: SQLDialect.DIALECT,
          },
        ],
      } as any,
      manifest: cityManifest,
      project: encryptedProject,
    });

    const validatedSql = denodoMcpAdaptor.validateSqlQuery.mock.calls[0][0];
    expect(validatedSql).toContain('"order_year_month" >= \'202506\'');
    expect(validatedSql).not.toContain('"ptstart"');
    expect(validatedSql).not.toContain('"ptend"');
    expect(wrenAIAdaptor.createSqlCorrection).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        'remove unavailable Denodo partition filter: dm_ord_month_city.ptstart',
        'remove unavailable Denodo partition filter: dm_ord_month_city.ptend',
      ]),
    );
    expect(result.timingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'denodo.unavailable_partition_filter_rewrite',
          metadata: expect.objectContaining({
            rewriteCount: 2,
          }),
        }),
      ]),
    );
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

  it('rewrites dense_rank top-n SQL before validation for denodo', async () => {
    const rankingManifest = {
      models: [
        {
          name: 'dm_ord_month_city',
          cached: false,
          tableReference: {
            table: 'dm_ord_month_city',
          },
          columns: [
            {
              name: 'city_name',
              isCalculated: false,
              expression: '"city_name"',
            },
            {
              name: 'total_order_amount',
              isCalculated: false,
              expression: '"total_order_amount"',
            },
            {
              name: 'order_year',
              isCalculated: false,
              expression: '"order_year"',
            },
          ],
        },
      ],
    } as any;
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
            sql: `WITH city_totals AS (SELECT dm_ord_month_city.city_name, SUM(dm_ord_month_city.total_order_amount) AS total_amount FROM dm_ord_month_city WHERE dm_ord_month_city.order_year = '2026' GROUP BY dm_ord_month_city.city_name), ranked_cities AS (SELECT city_totals.city_name, city_totals.total_amount, DENSE_RANK() OVER (ORDER BY city_totals.total_amount DESC) AS rank FROM city_totals) SELECT ranked_cities.city_name, ranked_cities.total_amount, ranked_cities.rank FROM ranked_cities WHERE ranked_cities.rank <= 5`,
          },
        ],
      } as any,
      manifest: rankingManifest,
      project: encryptedProject,
    });

    const validatedSql = denodoMcpAdaptor.validateSqlQuery.mock.calls[0][0];
    expect(validatedSql).not.toContain('DENSE_RANK');
    expect(validatedSql).toContain(
      'COUNT(DISTINCT "denodo_rank_source_1"."total_amount")',
    );
    expect(validatedSql).toContain('WHERE "ranked_cities"."rank" <= 5');
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        'rewrite dense_rank for denodo: city_totals.total_amount -> correlated subquery',
      ]),
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
        semanticContext: expect.stringContaining(
          denodoMcpUtils.DENODO_AI_CONTEXT_MARKER,
        ),
      }),
    );
    expect(denodoMcpAdaptor.validateSqlQuery).toHaveBeenCalledTimes(2);
    expect(result.sqlTraceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'denodo_guard_validate_attempt',
          attempt: 1,
          status: 'INVALID',
          error: "View 'dv_order_base' not found",
        }),
        expect.objectContaining({
          stage: 'denodo_guard_sql_correction_generated',
          attempt: 1,
          status: SqlCorrectionStatus.FINISHED,
          beforeSql: expect.stringContaining('FROM "dv_order_base"'),
          afterSql: 'SELECT "city" FROM "dv_order_base"',
        }),
        expect.objectContaining({
          stage: 'denodo_guard_validate_attempt',
          attempt: 2,
          status: 'VALID',
          validateSql: 'SELECT "city" FROM "dv_order_base"',
        }),
      ]),
    );
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

  it('treats validate tool exceptions as invalid SQL and runs correction', async () => {
    const denodoMcpAdaptor = {
      validateSqlQuery: jest
        .fn()
        .mockRejectedValueOnce(
          new Error("Cannot read properties of null (reading 'id')"),
        )
        .mockResolvedValueOnce({
          isValid: true,
        }),
    };
    const correctedSql =
      'SELECT "package_name", COUNT("biz_order_no") AS "order_count", AVG(CAST("package_price" AS DECIMAL(18, 2))) AS "avg_package_price" FROM "dv_package_order_core" WHERE lower("order_year_month") = lower(\'202604\') GROUP BY "package_name" ORDER BY "order_count" DESC';
    const wrenAIAdaptor = {
      createSqlCorrection: jest.fn().mockResolvedValue({ queryId: 'c-cte-1' }),
      getSqlCorrectionResult: jest.fn().mockResolvedValue({
        status: SqlCorrectionStatus.FINISHED,
        response: correctedSql,
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
            sql: `WITH "package_data" AS (
              SELECT "package_name", "biz_order_no", CAST("package_price" AS DECIMAL(18, 2)) AS "package_price_decimal"
              FROM "dv_package_order_core"
              WHERE lower("order_year_month") = lower('202604')
            )
            SELECT "package_data"."package_name", COUNT("package_data"."biz_order_no") AS "order_count", AVG("package_data"."package_price_decimal") AS "avg_package_price"
            FROM "package_data"
            GROUP BY "package_data"."package_name"
            ORDER BY "order_count" DESC`,
            sqlDialect: SQLDialect.DIALECT,
          },
        ],
      } as any,
      manifest,
      project: encryptedProject,
    });

    expect(wrenAIAdaptor.createSqlCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Cannot read properties of null (reading 'id')",
        validationMode: 'none',
      }),
    );
    expect(denodoMcpAdaptor.validateSqlQuery).toHaveBeenCalledTimes(2);
    expect(result.response?.[0]?.sql).toBe(correctedSql);
    expect(result.sqlTraceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'denodo_guard_validate_attempt',
          attempt: 1,
          status: 'INVALID',
          error: "Cannot read properties of null (reading 'id')",
        }),
        expect.objectContaining({
          stage: 'denodo_guard_validate_attempt',
          attempt: 2,
          status: 'VALID',
          validateSql: correctedSql,
        }),
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
        semanticContext: expect.stringContaining(
          denodoMcpUtils.DENODO_AI_CONTEXT_MARKER,
        ),
      }),
    );
    expect(wrenAIAdaptor.createSqlCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        semanticContext: expect.stringContaining('scope: dv_order_base.city'),
      }),
    );
  });
});
