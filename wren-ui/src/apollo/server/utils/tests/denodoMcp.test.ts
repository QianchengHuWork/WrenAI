import { Manifest } from '@server/mdl/type';
import {
  DENODO_AI_CONTEXT_MARKER,
  applySemanticDictionaryToSql,
  buildDenodoDataCatalogBaseUrl,
  buildDenodoDataCatalogUri,
  buildDenodoAiSemanticContext,
  buildDenodoAskAugmentation,
  buildDenodoNativeVqlSchemaContext,
  buildDenodoSemanticDictionaryBatchContext,
  buildDenodoSemanticDictionaryBatches,
  buildDenodoSemanticDictionary,
  buildFallbackDenodoSemanticDictionaryEntries,
  buildDenodoSemanticDictionaryTasks,
  filterDenodoRawSchemaViews,
  normalizeDenodoSemanticDictionaryEntries,
  toDenodoManifestRelationships,
  toDenodoSemanticContext,
  toDenodoCompactTables,
  toDenodoNativeSql,
  sanitizeDenodoDialectSql,
  removeUnavailableDenodoPartitionFilters,
  toDenodoPreviewData,
} from '../denodoMcp';

describe('denodoMcp utils', () => {
  it('maps MCP schema into compact tables', () => {
    const result = toDenodoCompactTables({
      structuredContent: {
        views: [
          {
            view_name: 'dv_order_base',
            description: '订单基础视图',
            primary_key: 'request_id',
            schema: 'admin',
            columns: [
              {
                name: 'request_id',
                data_type: 'NVARCHAR',
                description: '请求 ID',
              },
              {
                name: 'is_ord_pay',
                data_type: 'INTEGER',
                description: '是否支付',
              },
            ],
          },
        ],
      },
    });

    expect(result).toEqual([
      {
        name: 'dv_order_base',
        description: '订单基础视图',
        primaryKey: 'request_id',
        properties: {
          table: 'dv_order_base',
          schema: 'admin',
          description: '订单基础视图',
        },
        columns: [
          {
            name: 'request_id',
            type: 'string',
            notNull: false,
            description: '请求 ID',
            properties: {
              description: '请求 ID',
            },
          },
          {
            name: 'is_ord_pay',
            type: 'integer',
            notNull: false,
            description: '是否支付',
            properties: {
              description: '是否支付',
            },
          },
        ],
      },
    ]);
  });

  it('maps MCP query result into preview rows', () => {
    const result = toDenodoPreviewData({
      structuredContent: {
        data: [
          { city: '上海', row_cnt: 12, is_paid: true },
          { city: '杭州', row_cnt: 8, is_paid: false },
        ],
      },
    });

    expect(result.columns).toEqual([
      { name: 'city', type: 'string' },
      { name: 'row_cnt', type: 'number' },
      { name: 'is_paid', type: 'boolean' },
    ]);
    expect(result.data).toEqual([
      ['上海', 12, true],
      ['杭州', 8, false],
    ]);
  });

  it('filters raw schema down to the selected Denodo views', () => {
    const rawSchema = {
      structuredContent: {
        views: [
          { view_name: 'dv_ord_core', columns: [] },
          { view_name: 'dm_ord_month_city', columns: [] },
        ],
      },
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            views: [
              { view_name: 'dv_ord_core', columns: [] },
              { view_name: 'dm_ord_month_city', columns: [] },
            ],
          }),
        },
      ],
    };

    const result = filterDenodoRawSchemaViews(rawSchema, ['dm_ord_month_city']);

    expect(result.structuredContent.views).toEqual([
      { view_name: 'dm_ord_month_city', columns: [] },
    ]);
    expect(JSON.parse(result.content[0].text)).toEqual({
      views: [{ view_name: 'dm_ord_month_city', columns: [] }],
    });
  });

  it('derives Denodo Data Catalog endpoints from MCP baseUrl', () => {
    expect(
      buildDenodoDataCatalogBaseUrl(
        'http://180.153.254.194:19090/admin_database/mcp',
      ),
    ).toBe('http://180.153.254.194:9090/denodo-data-catalog/public/api');
    expect(
      buildDenodoDataCatalogUri(
        'http://180.153.254.194:19090/admin_database/mcp',
      ),
    ).toBe('//180.153.254.194:9999/admin');
  });

  it('converts Denodo associations into manifest relationships and skips unsafe mappings', () => {
    const result = toDenodoManifestRelationships({
      associations: [
        {
          name: 'assoc_profile_assign',
          description: '主档到分配事件',
          leftViewName: 'j_cfc_clew_profile_semantic_std',
          rightViewName: 'j_clew_assign_event_semantic_std',
          leftMultiplicity: '1',
          rightMultiplicity: '0,*',
          mapping:
            'j_cfc_clew_profile_semantic_std.clew_id=j_clew_assign_event_semantic_std.clew_id AND j_cfc_clew_profile_semantic_std.bizline_id=j_clew_assign_event_semantic_std.bizline_id',
          valid: true,
          leftRole: 'profile',
          rightRole: 'assign_events',
          leftRoleDescription: '主档端',
          rightRoleDescription: '事件端',
          leftPrincipal: false,
        },
        {
          name: 'assoc_profile_assign',
          leftViewName: 'j_cfc_clew_profile_semantic_std',
          rightViewName: 'j_clew_assign_event_semantic_std',
          leftMultiplicity: '1',
          rightMultiplicity: '0,*',
          mapping:
            'j_cfc_clew_profile_semantic_std.clew_id=j_clew_assign_event_semantic_std.clew_id AND j_cfc_clew_profile_semantic_std.bizline_id=j_clew_assign_event_semantic_std.bizline_id',
          valid: true,
        },
        {
          name: 'assoc_profile_conversion',
          leftViewName: 'j_cfc_clew_profile_semantic_std',
          rightViewName: 'j_clew_ord_conversion_semantic_std',
          leftMultiplicity: '1',
          rightMultiplicity: '0,*',
          mapping:
            'lower(j_cfc_clew_profile_semantic_std.clew_id)=j_clew_ord_conversion_semantic_std.clew_id',
          valid: true,
        },
        {
          name: 'assoc_out_of_scope',
          leftViewName: 'j_cfc_clew_profile_semantic_std',
          rightViewName: 'j_external_view',
          leftMultiplicity: '1',
          rightMultiplicity: '*',
          mapping:
            'j_cfc_clew_profile_semantic_std.clew_id=j_external_view.clew_id',
          valid: true,
        },
      ],
      selectedViews: [
        'j_cfc_clew_profile_semantic_std',
        'j_clew_assign_event_semantic_std',
        'j_clew_ord_conversion_semantic_std',
      ],
      reservedNames: ['existing_relation'],
    });

    expect(result.relationships).toEqual([
      {
        name: 'assoc_profile_assign',
        models: [
          'j_cfc_clew_profile_semantic_std',
          'j_clew_assign_event_semantic_std',
        ],
        joinType: 'ONE_TO_MANY',
        condition:
          '"j_cfc_clew_profile_semantic_std".clew_id = "j_clew_assign_event_semantic_std".clew_id AND "j_cfc_clew_profile_semantic_std".bizline_id = "j_clew_assign_event_semantic_std".bizline_id',
        properties: {
          description: '主档到分配事件',
          leftRole: 'profile',
          rightRole: 'assign_events',
          leftRoleDescription: '主档端',
          rightRoleDescription: '事件端',
          leftPrincipal: false,
          source: 'DENODO_ASSOCIATION',
        },
      },
    ]);
    expect(result.warnings).toEqual([
      expect.stringContaining('assoc_profile_conversion'),
    ]);
  });

  it('builds semantic dictionary tasks from candidate columns and batches by column scope', () => {
    const manifest = {
      models: [
        {
          name: 'dv_ord_core',
          cached: false,
          properties: {
            description: '订单核心事实表',
          },
          tableReference: {
            table: 'dv_ord_core',
          },
          columns: [
            {
              name: 'order_status',
              type: 'string',
              properties: {
                description:
                  'B端订单状态。枚举值：待支付、已支付、交付中、已完成、已退款。',
              },
              isCalculated: false,
              expression: '"order_status"',
            },
            {
              name: 'order_amount',
              type: 'number',
              properties: { description: '订单总金额' },
              isCalculated: false,
              expression: '"order_amount"',
            },
            {
              name: 'city',
              type: 'string',
              properties: { description: '订单所在城市' },
              isCalculated: false,
              expression: '"city"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const rawSchema = {
      structuredContent: {
        views: [
          {
            view_name: 'dv_ord_core',
            description: '订单核心事实表',
            columns: [
              {
                name: 'order_status',
                data_type: 'VARCHAR',
                description:
                  'B端订单状态。枚举值：待支付、已支付、交付中、已完成、已退款。',
              },
              {
                name: 'order_amount',
                data_type: 'DECIMAL',
                description: '订单总金额',
              },
              {
                name: 'city',
                data_type: 'VARCHAR',
                description: '订单所在城市',
              },
            ],
          },
        ],
      },
    };

    const tasks = buildDenodoSemanticDictionaryTasks({ manifest, rawSchema });
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: 'dv_ord_core.order_status.已完成',
          canonicalValue: '已完成',
        }),
        expect.objectContaining({
          taskId: 'dv_ord_core.order_status.待支付',
          canonicalValue: '待支付',
        }),
      ]),
    );
    expect(tasks.some((task) => task.scope.column === 'order_amount')).toBe(
      false,
    );

    const batches = buildDenodoSemanticDictionaryBatches(tasks, 1);
    expect(batches).toHaveLength(1);
    expect(
      batches.find((batch) =>
        batch.some((task) => task.scope.column === 'order_status'),
      ),
    ).toHaveLength(tasks.length);

    const context = buildDenodoSemanticDictionaryBatchContext({
      tasks: batches[0],
      manifest,
      rawSchema,
    });
    expect(context.manifestSummary.models).toHaveLength(1);
    expect(context.rawSchemaSummary.views).toHaveLength(1);
  });

  it('normalizes batch semantic dictionary results into stable entries', () => {
    const tasks = [
      {
        taskId: 'dv_ord_core.order_status.已完成',
        scope: { model: 'dv_ord_core', column: 'order_status' },
        canonicalValue: '已完成',
        description: 'B端订单状态',
      },
      {
        taskId: 'dv_ord_core.order_status.已支付',
        scope: { model: 'dv_ord_core', column: 'order_status' },
        canonicalValue: '已支付',
        description: 'B端订单状态',
      },
    ];

    const entries = normalizeDenodoSemanticDictionaryEntries({
      tasks,
      result: {
        items: [
          {
            taskId: 'dv_ord_core.order_status.已完成',
            description: '订单履约状态',
            aliases: ['已交付', '交付完成'],
          },
          {
            taskId: 'dv_ord_core.order_status.已支付',
            aliases: ['付款成功'],
          },
        ],
      },
    });

    expect(entries).toEqual([
      {
        scope: { model: 'dv_ord_core', column: 'order_status' },
        description: '订单履约状态',
        aliases: ['已交付', '交付完成'],
        canonicalValue: '已完成',
      },
      {
        scope: { model: 'dv_ord_core', column: 'order_status' },
        description: 'B端订单状态',
        aliases: ['付款成功'],
        canonicalValue: '已支付',
      },
    ]);
  });

  it('builds deterministic fallback entries from enum descriptions', () => {
    const tasks = [
      {
        taskId: 'dv_ord_core.order_status.已完成',
        scope: { model: 'dv_ord_core', column: 'order_status' },
        canonicalValue: '已完成',
        description:
          '订单状态中文值。由基础订单表 order_status_value 重命名而来。枚举值：待支付、已支付、已锁单、交付中、已完成、已退款。',
      },
      {
        taskId: 'dv_ord_core.order_status_code.COMPLETED',
        scope: { model: 'dv_ord_core', column: 'order_status_code' },
        canonicalValue: 'COMPLETED',
        description:
          '订单状态编码。枚举值：CREATED=待支付，PAID=已支付，LOCKED=已锁单，DELIVERING=交付中，COMPLETED=已完成，REFUNDED=已退款。',
      },
    ];

    const entries = buildFallbackDenodoSemanticDictionaryEntries({ tasks });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: { model: 'dv_ord_core', column: 'order_status' },
          canonicalValue: '已完成',
          aliases: expect.arrayContaining(['已完成', '已交付', '交付完成']),
        }),
        expect.objectContaining({
          scope: { model: 'dv_ord_core', column: 'order_status_code' },
          canonicalValue: 'COMPLETED',
          aliases: expect.arrayContaining(['已完成', '已交付', '交付完成']),
        }),
      ]),
    );
  });

  it('quotes model and column identifiers for Denodo and strips limit', () => {
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
            {
              name: 'request_id',
              isCalculated: false,
              expression: '"request_id"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      'SELECT city, COUNT(request_id) AS row_cnt FROM dv_order_base GROUP BY city LIMIT 10',
      manifest,
    );

    expect(sql).toContain('SELECT "city", COUNT("request_id") AS "row_cnt"');
    expect(sql).toContain('FROM "dv_order_base"');
    expect(sql).toContain('GROUP BY "city"');
    expect(sql).not.toContain('LIMIT');
  });

  it('quotes aliases in join queries', () => {
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
            {
              name: 'request_id',
              isCalculated: false,
              expression: '"request_id"',
            },
          ],
        },
        {
          name: 'dv_assign_log_base',
          cached: false,
          tableReference: {
            table: 'dv_assign_log_base',
          },
          columns: [
            {
              name: 'request_id',
              isCalculated: false,
              expression: '"request_id"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      'SELECT a.city FROM dv_order_base a LEFT JOIN dv_assign_log_base b ON a.request_id = b.request_id',
      manifest,
    );

    expect(sql).toContain('FROM "dv_order_base" AS "a"');
    expect(sql).toContain('LEFT JOIN "dv_assign_log_base" AS "b"');
    expect(sql).toContain('SELECT "a"."city"');
    expect(sql).toContain('"a"."request_id" = "b"."request_id"');
  });

  it('preserves CROSS JOIN during Denodo SQL rewriting', () => {
    const manifest = {
      models: [
        {
          name: 'city_conversion',
          cached: false,
          tableReference: {
            table: 'city_conversion',
          },
          columns: [
            {
              name: 'assign_city_id',
              isCalculated: false,
              expression: '"assign_city_id"',
            },
          ],
        },
        {
          name: 'national_avg',
          cached: false,
          tableReference: {
            table: 'national_avg',
          },
          columns: [
            {
              name: 'avg_conversion_rate',
              isCalculated: false,
              expression: '"avg_conversion_rate"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      'SELECT assign_city_id FROM city_conversion CROSS JOIN national_avg',
      manifest,
    );

    expect(sql).toContain('FROM "city_conversion" CROSS JOIN "national_avg"');
    expect(sql).not.toContain('AS "CROSS" INNER JOIN');
  });

  it('normalizes TIMESTAMP WITH TIME ZONE casts for Denodo', () => {
    const manifest = {
      models: [
        {
          name: 'dwd_ord_wife_det_h',
          cached: false,
          tableReference: {
            table: 'dwd_ord_wife_det_h',
          },
          columns: [
            {
              name: 'city',
              isCalculated: false,
              expression: '"city"',
            },
            {
              name: 'order_amt',
              isCalculated: false,
              expression: '"order_amt"',
            },
            {
              name: 'ord_create_time',
              isCalculated: false,
              expression: '"ord_create_time"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      `WITH city_order_amount AS (
        SELECT dwd_ord_wife_det_h.city AS city,
               SUM(CAST(dwd_ord_wife_det_h.order_amt AS DECIMAL)) AS total_amount
        FROM dwd_ord_wife_det_h
        WHERE CAST(dwd_ord_wife_det_h.ord_create_time AS TIMESTAMP WITH TIME ZONE) >= CAST('2026-01-01 00:00:00' AS TIMESTAMP WITH TIME ZONE)
        GROUP BY dwd_ord_wife_det_h.city
      )
      SELECT city, total_amount FROM city_order_amount`,
      manifest,
    );

    expect(sql).toContain('"dwd_ord_wife_det_h"."ord_create_time"');
    expect(sql).toContain(
      'CAST("dwd_ord_wife_det_h"."ord_create_time" AS TIMESTAMP)',
    );
    expect(sql).not.toContain('WITH TIME ZONE');
  });

  it('rewrites IN predicates using semantic dictionary aliases only when mappings are unique', () => {
    const manifest = {
      models: [
        {
          name: 'dv_ord_core',
          cached: false,
          tableReference: { table: 'dv_ord_core' },
          columns: [
            {
              name: 'order_status',
              isCalculated: false,
              expression: '"order_status"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const rewritten = applySemanticDictionaryToSql(
      `SELECT * FROM "dv_ord_core" WHERE "dv_ord_core"."order_status" IN ('已交付', '已完成')`,
      manifest,
      buildDenodoSemanticDictionary([
        {
          scope: { model: 'dv_ord_core', column: 'order_status' },
          aliases: ['已交付', '交付完成'],
          canonicalValue: '已完成',
        },
      ]),
    );

    expect(rewritten.sql).toContain(`IN ('已完成', '已完成')`);
    expect(rewritten.appliedRewrites).toContain(
      'apply semantic rewrite: dv_ord_core.order_status: 已交付 -> 已完成',
    );
  });

  it('rewrites DATE_PART and TO_NUMBER into Denodo-compatible SQL', () => {
    const manifest = {
      models: [
        {
          name: 'dwd_ord_wife_det_h',
          cached: false,
          tableReference: {
            table: 'dwd_ord_wife_det_h',
          },
          columns: [
            {
              name: 'city',
              isCalculated: false,
              expression: '"city"',
            },
            {
              name: 'actual_price',
              isCalculated: false,
              expression: '"actual_price"',
            },
            {
              name: 'ord_create_time',
              isCalculated: false,
              expression: '"ord_create_time"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      `SELECT
         dwd_ord_wife_det_h.city,
         SUM(TO_NUMBER(dwd_ord_wife_det_h.actual_price)) AS total_amount
       FROM dwd_ord_wife_det_h
       WHERE DATE_PART('year', CAST(dwd_ord_wife_det_h.ord_create_time AS TIMESTAMP WITH TIME ZONE)) = 2026
       GROUP BY dwd_ord_wife_det_h.city`,
      manifest,
    );

    expect(sql).toMatch(
      /COALESCE\(SUM\(CAST\("dwd_ord_wife_det_h"\."actual_price" AS DECIMAL\(\s*18,\s*2\s*\)\)\), 0\) AS "total_amount"/,
    );
    expect(sql).toContain(
      'EXTRACT(YEAR FROM CAST("dwd_ord_wife_det_h"."ord_create_time" AS TIMESTAMP)) = 2026',
    );
    expect(sql).not.toContain('DATE_PART');
    expect(sql).not.toContain('TO_NUMBER');
  });

  it('sanitizes direct Denodo dialect SQL expressions without remapping tables', () => {
    const sql = sanitizeDenodoDialectSql(
      `SELECT
         "dv_package_order_core"."package_name" AS "package_name",
         COUNT("dv_package_order_core"."biz_order_no") AS "order_count",
         AVG(TO_NUMBER("dv_package_order_core"."package_price")) AS "avg_price_increase"
       FROM "dv_package_order_core" AS "dv_package_order_core"
       WHERE LOWER("dv_package_order_core"."order_year_month") = LOWER('202604')
       GROUP BY "dv_package_order_core"."package_name"
       ORDER BY "order_count" DESC`,
    );

    expect(sql).toContain('FROM "dv_package_order_core"');
    expect(sql).toContain(
      'AVG(CAST("dv_package_order_core"."package_price" AS DECIMAL(18, 2))) AS "avg_price_increase"',
    );
    expect(sql).not.toContain('TO_NUMBER');
  });

  it('removes unavailable Denodo partition filters per view', () => {
    const manifest = {
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
            {
              name: 'total_order_amount',
              isCalculated: false,
              expression: '"total_order_amount"',
            },
          ],
        },
        {
          name: 'dv_clew_ord_conversion_core',
          cached: false,
          tableReference: {
            table: 'dv_clew_ord_conversion_core',
          },
          columns: [
            {
              name: 'clew_year_month',
              isCalculated: false,
              expression: '"clew_year_month"',
            },
            {
              name: 'ptstart',
              isCalculated: false,
              expression: '"ptstart"',
            },
            {
              name: 'ptend',
              isCalculated: false,
              expression: '"ptend"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const result = removeUnavailableDenodoPartitionFilters(
      `WITH "top_cities" AS (
        SELECT "city_code", SUM("total_order_amount") AS "total_order_amount"
        FROM "dm_ord_month_city"
        WHERE "order_year_month" >= '202506'
          AND "ptstart" >= '20250601'
          AND "ptend" <= '20260531'
        GROUP BY "city_code"
      ),
      "city_monthly_conversion" AS (
        SELECT "clew_year_month"
        FROM "dv_clew_ord_conversion_core"
        WHERE "clew_year_month" >= '202506'
          AND "ptstart" >= '20250601'
          AND "ptend" <= '20260531'
      )
      SELECT * FROM "top_cities"`,
      manifest,
    );

    expect(result.appliedRewrites).toEqual(
      expect.arrayContaining([
        'remove unavailable Denodo partition filter: dm_ord_month_city.ptstart',
        'remove unavailable Denodo partition filter: dm_ord_month_city.ptend',
      ]),
    );
    expect(result.sql).toContain('"dm_ord_month_city"');
    expect(result.sql).toContain('"order_year_month" >= \'202506\'');
    expect(result.sql).toContain(
      'FROM "dm_ord_month_city" WHERE "order_year_month" >= \'202506\' GROUP BY "city_code"',
    );
    expect(result.sql).not.toContain(
      'FROM "dm_ord_month_city" WHERE "order_year_month" >= \'202506\' AND "ptstart"',
    );
    expect(result.sql).toContain(
      'FROM "dv_clew_ord_conversion_core" WHERE "clew_year_month" >= \'202506\' AND "ptstart" >= \'20250601\' AND "ptend" <= \'20260531\'',
    );
  });

  it('rewrites monthly conversion queries into Denodo-safe buckets and float rate casts', () => {
    const manifest = {
      models: [
        {
          name: 'ads_zai_online_niche_assign_drive_order_hf',
          cached: false,
          tableReference: {
            table: 'ads_zai_online_niche_assign_drive_order_hf',
          },
          columns: [
            {
              name: 'create_time',
              isCalculated: false,
              expression: '"create_time"',
            },
            {
              name: 'mobile_md5',
              isCalculated: false,
              expression: '"mobile_md5"',
            },
          ],
        },
        {
          name: 'dwd_ord_wife_det_h',
          cached: false,
          tableReference: {
            table: 'dwd_ord_wife_det_h',
          },
          columns: [
            {
              name: 'ord_create_time',
              isCalculated: false,
              expression: '"ord_create_time"',
            },
            {
              name: 'hxn_phone_md5',
              isCalculated: false,
              expression: '"hxn_phone_md5"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      `WITH monthly_leads AS (
         SELECT DATETRUNC('month', CAST(create_time AS TIMESTAMP WITH TIME ZONE)) AS month,
                COUNT(DISTINCT mobile_md5) AS leads_count
         FROM ads_zai_online_niche_assign_drive_order_hf
         GROUP BY DATETRUNC('month', CAST(create_time AS TIMESTAMP WITH TIME ZONE))
       ),
       monthly_orders AS (
         SELECT DATE_TRUNC('month', CAST(dwd_ord_wife_det_h.ord_create_time AS TIMESTAMP WITH TIME ZONE)) AS month,
                COUNT(DISTINCT dwd_ord_wife_det_h.hxn_phone_md5) AS orders_count
         FROM dwd_ord_wife_det_h
         GROUP BY DATE_TRUNC('month', CAST(dwd_ord_wife_det_h.ord_create_time AS TIMESTAMP WITH TIME ZONE))
       ),
       monthly_metrics AS (
         SELECT COALESCE(l.month, o.month) AS month,
                COALESCE(l.leads_count, 0) AS leads_count,
                COALESCE(o.orders_count, 0) AS orders_count
         FROM monthly_leads l
         FULL OUTER JOIN monthly_orders o ON l.month = o.month
       )
       SELECT month,
              CASE
                WHEN orders_count > 0 AND leads_count > 0
                  THEN (CAST(orders_count AS DOUBLE) / CAST(leads_count AS DOUBLE)) * 100
                ELSE 0
              END AS conversion_rate
       FROM monthly_metrics
       ORDER BY month`,
      manifest,
    );

    expect(sql).not.toContain('DATE_TRUNC');
    expect(sql).not.toContain('DATETRUNC');
    expect(sql).toContain('FULL OUTER JOIN');
    expect(sql).toContain('CAST("orders_count" AS FLOAT)');
    expect(sql).toContain('CAST("leads_count" AS FLOAT)');
    expect(sql).toContain(
      'EXTRACT(YEAR FROM CAST("create_time" AS TIMESTAMP)) * 100 + EXTRACT(MONTH FROM CAST("create_time" AS TIMESTAMP)) AS "month"',
    );
    expect(sql).toContain(
      'EXTRACT(YEAR FROM CAST("dwd_ord_wife_det_h"."ord_create_time" AS TIMESTAMP)) * 100 + EXTRACT(MONTH FROM CAST("dwd_ord_wife_det_h"."ord_create_time" AS TIMESTAMP)) AS "month"',
    );
  });

  it('converts decimal casts back to float for count-based conversion rates', () => {
    const manifest = {
      models: [
        {
          name: 'dv_clew_ord_conversion_core',
          cached: false,
          tableReference: {
            table: 'dv_clew_ord_conversion_core',
          },
          columns: [
            {
              name: 'assign_city_id',
              isCalculated: false,
              expression: '"assign_city_id"',
            },
            {
              name: 'converted_order_count',
              isCalculated: false,
              expression: '"converted_order_count"',
            },
            {
              name: 'assigned_clew_count',
              isCalculated: false,
              expression: '"assigned_clew_count"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      `SELECT assign_city_id,
              CAST(COALESCE(SUM(converted_order_count), 0) AS DECIMAL(18, 6))
                / NULLIF(CAST(COALESCE(SUM(assigned_clew_count), 0) AS DECIMAL(18, 6)), 0) AS conversion_rate
       FROM dv_clew_ord_conversion_core
       GROUP BY assign_city_id`,
      manifest,
    );

    expect(sql).toContain('AS FLOAT)');
    expect(sql).toContain('NULLIF');
    expect(sql).not.toContain('AS DECIMAL(18, 6)');
  });

  it('rewrites day buckets for daily trend queries', () => {
    const manifest = {
      models: [
        {
          name: 'ads_zai_online_niche_assign_drive_order_hf',
          cached: false,
          tableReference: {
            table: 'ads_zai_online_niche_assign_drive_order_hf',
          },
          columns: [
            {
              name: 'create_time',
              isCalculated: false,
              expression: '"create_time"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      `SELECT DATE_TRUNC('day', CAST(create_time AS TIMESTAMP WITH TIME ZONE)) AS day_bucket,
              COUNT(*) AS clue_count
       FROM ads_zai_online_niche_assign_drive_order_hf
       GROUP BY DATE_TRUNC('day', CAST(create_time AS TIMESTAMP WITH TIME ZONE))
       ORDER BY day_bucket`,
      manifest,
    );

    expect(sql).not.toContain('DATE_TRUNC');
    expect(sql).toContain(
      'EXTRACT(YEAR FROM CAST("create_time" AS TIMESTAMP)) * 10000 + EXTRACT(MONTH FROM CAST("create_time" AS TIMESTAMP)) * 100 + EXTRACT(DAY FROM CAST("create_time" AS TIMESTAMP)) AS "day_bucket"',
    );
  });

  it('wraps SUM aggregates with COALESCE to avoid null totals', () => {
    const manifest = {
      models: [
        {
          name: 'dwd_ord_wife_det_h',
          cached: false,
          tableReference: {
            table: 'dwd_ord_wife_det_h',
          },
          columns: [
            {
              name: 'actual_price',
              isCalculated: false,
              expression: '"actual_price"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const sql = toDenodoNativeSql(
      'SELECT SUM(TO_NUMBER(actual_price)) AS total_amount FROM dwd_ord_wife_det_h',
      manifest,
    );

    expect(sql).toContain(
      'COALESCE(SUM(CAST("actual_price" AS DECIMAL(18, 2))), 0) AS "total_amount"',
    );
  });

  it('builds semantic context for relevant models only', () => {
    const context = toDenodoSemanticContext(
      buildDenodoSemanticDictionary([
        {
          scope: {
            model: 'dv_ord_core',
            column: 'order_status',
          },
          description: '订单状态字段，包含已完成等交付语义',
          aliases: ['已交付', '交付完成'],
          canonicalValue: '已完成',
        },
      ]),
      {
        models: ['dv_ord_core'],
      },
    );

    expect(context).toContain('scope: dv_ord_core.order_status');
    expect(context).toContain('canonical: 已完成');
    expect(context).not.toContain('dim_city.city_name');
  });

  it('wraps denodo AI semantic context with a stable marker', () => {
    const context = buildDenodoAiSemanticContext(
      '- scope: dv_ord_core.order_status | canonical: 已完成',
    );

    expect(context).toContain(DENODO_AI_CONTEXT_MARKER);
    expect(context).toContain('Denodo VQL');
    expect(context).toContain('scope: dv_ord_core.order_status');
  });

  it('builds native denodo VQL schema mapping for prompt context', () => {
    const manifest = {
      models: [
        {
          name: 'order_model',
          cached: false,
          tableReference: {
            table: 'dv_ord_core',
          },
          columns: [
            {
              name: 'order_amount',
              isCalculated: false,
              expression: '"paid_amt"',
            },
            {
              name: 'city_name',
              isCalculated: false,
            },
          ],
        },
      ],
    } satisfies Manifest;

    const context = buildDenodoNativeVqlSchemaContext(manifest);

    expect(context).toContain('order_model -> native view "dv_ord_core"');
    expect(context).toContain('"paid_amt"');
    expect(context).toContain('"city_name"');
    expect(context).toContain('do not generate logical Wren SQL');
  });

  it('builds denodo ask augmentation marker without semantic dictionary', async () => {
    const originalEnableSemanticDictionary =
      process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY;
    process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY = 'false';

    try {
      const augmentation = await buildDenodoAskAugmentation(7);

      expect(augmentation.semanticContext).toContain(DENODO_AI_CONTEXT_MARKER);
      expect(augmentation.semanticDictionary).toBeUndefined();
    } finally {
      if (originalEnableSemanticDictionary === undefined) {
        delete process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY;
      } else {
        process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY =
          originalEnableSemanticDictionary;
      }
    }
  });

  it('rewrites scoped semantic aliases into canonical values', () => {
    const manifest = {
      models: [
        {
          name: 'dv_ord_core',
          cached: false,
          tableReference: {
            table: 'dv_ord_core',
          },
          columns: [
            {
              name: 'order_status',
              isCalculated: false,
              expression: '"order_status"',
            },
            {
              name: 'order_amount',
              isCalculated: false,
              expression: '"order_amount"',
            },
          ],
        },
      ],
    } satisfies Manifest;

    const result = applySemanticDictionaryToSql(
      `SELECT SUM("dv_ord_core"."order_amount") AS "total_amount"
       FROM "dv_ord_core"
       WHERE lower("dv_ord_core"."order_status") LIKE lower('%已交付%')`,
      manifest,
      buildDenodoSemanticDictionary([
        {
          scope: {
            model: 'dv_ord_core',
            column: 'order_status',
          },
          aliases: ['已交付', '交付完成'],
          canonicalValue: '已完成',
        },
      ]),
    );

    expect(result.sql).toContain(`"dv_ord_core"."order_status" = '已完成'`);
    expect(result.sql).not.toContain('已交付');
    expect(result.appliedRewrites).toEqual([
      'apply semantic rewrite: dv_ord_core.order_status: 已交付 -> 已完成',
    ]);
  });
});
