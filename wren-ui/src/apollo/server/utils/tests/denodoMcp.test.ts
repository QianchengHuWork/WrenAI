import { Manifest } from '@server/mdl/type';
import {
  applySemanticDictionaryToSql,
  buildDenodoSemanticDictionaryBatchContext,
  buildDenodoSemanticDictionaryBatches,
  buildDenodoSemanticDictionary,
  buildFallbackDenodoSemanticDictionaryEntries,
  buildDenodoSemanticDictionaryTasks,
  filterDenodoRawSchemaViews,
  normalizeDenodoSemanticDictionaryEntries,
  toDenodoSemanticContext,
  toDenodoCompactTables,
  toDenodoNativeSql,
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
              properties: { description: 'B端订单状态' },
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
                description: 'B端订单状态',
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
          taskId: 'dv_ord_core.order_status.COLUMN_HINT',
          rewriteMode: 'COLUMN_HINT',
        }),
        expect.objectContaining({
          taskId: 'dv_ord_core.order_status.VALUE_ALIAS',
          rewriteMode: 'VALUE_ALIAS',
        }),
        expect.objectContaining({
          taskId: 'dv_ord_core.order_amount.COLUMN_HINT',
          rewriteMode: 'COLUMN_HINT',
        }),
      ]),
    );

    const batches = buildDenodoSemanticDictionaryBatches(tasks, 1);
    expect(batches).toHaveLength(3);
    expect(
      batches.find((batch) =>
        batch.some((task) => task.scope.column === 'order_status'),
      ),
    ).toHaveLength(2);

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
        taskId: 'dv_ord_core.order_status.COLUMN_HINT',
        scope: { model: 'dv_ord_core', column: 'order_status' },
        rewriteMode: 'COLUMN_HINT' as const,
        description: 'B端订单状态',
      },
      {
        taskId: 'dv_ord_core.order_status.VALUE_ALIAS',
        scope: { model: 'dv_ord_core', column: 'order_status' },
        rewriteMode: 'VALUE_ALIAS' as const,
        description: 'B端订单状态',
      },
    ];

    const entries = normalizeDenodoSemanticDictionaryEntries({
      tasks,
      result: {
        items: [
          {
            taskId: 'dv_ord_core.order_status.COLUMN_HINT',
            concept: '订单履约状态',
            aliases: ['订单状态', '履约状态'],
          },
          {
            taskId: 'dv_ord_core.order_status.VALUE_ALIAS',
            concept: '订单履约状态',
            valueMappings: [
              {
                canonicalValue: '已完成',
                aliases: ['已交付', '交付完成'],
              },
            ],
          },
        ],
      },
    });

    expect(entries).toEqual([
      {
        scope: { model: 'dv_ord_core', column: 'order_status' },
        concept: '订单履约状态',
        description: 'B端订单状态',
        aliases: ['订单状态', '履约状态', '订单履约状态'],
        rewriteMode: 'COLUMN_HINT',
      },
      {
        scope: { model: 'dv_ord_core', column: 'order_status' },
        concept: '订单履约状态',
        description: 'B端订单状态',
        aliases: ['已交付', '交付完成'],
        canonicalValue: '已完成',
        rewriteMode: 'VALUE_ALIAS',
      },
    ]);
  });

  it('builds deterministic fallback entries from enum descriptions', () => {
    const tasks = [
      {
        taskId: 'dv_ord_core.order_status.COLUMN_HINT',
        scope: { model: 'dv_ord_core', column: 'order_status' },
        rewriteMode: 'COLUMN_HINT' as const,
        description:
          '订单状态中文值。由基础订单表 order_status_value 重命名而来。枚举值：待支付、已支付、已锁单、交付中、已完成、已退款。',
      },
      {
        taskId: 'dv_ord_core.order_status.VALUE_ALIAS',
        scope: { model: 'dv_ord_core', column: 'order_status' },
        rewriteMode: 'VALUE_ALIAS' as const,
        description:
          '订单状态中文值。由基础订单表 order_status_value 重命名而来。枚举值：待支付、已支付、已锁单、交付中、已完成、已退款。',
      },
      {
        taskId: 'dv_ord_core.order_status_code.VALUE_ALIAS',
        scope: { model: 'dv_ord_core', column: 'order_status_code' },
        rewriteMode: 'VALUE_ALIAS' as const,
        description:
          '订单状态编码。枚举值：CREATED=待支付，PAID=已支付，LOCKED=已锁单，DELIVERING=交付中，COMPLETED=已完成，REFUNDED=已退款。',
      },
    ];

    const entries = buildFallbackDenodoSemanticDictionaryEntries({ tasks });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: { model: 'dv_ord_core', column: 'order_status' },
          rewriteMode: 'COLUMN_HINT',
          concept: '订单状态中文值。由基础订单表 order_status_value 重命名而来',
        }),
        expect.objectContaining({
          scope: { model: 'dv_ord_core', column: 'order_status' },
          rewriteMode: 'VALUE_ALIAS',
          canonicalValue: '已完成',
          aliases: expect.arrayContaining(['已完成', '已交付', '交付完成']),
        }),
        expect.objectContaining({
          scope: { model: 'dv_ord_core', column: 'order_status_code' },
          rewriteMode: 'VALUE_ALIAS',
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
          concept: '订单履约状态',
          aliases: ['已交付', '交付完成'],
          canonicalValue: '已完成',
          rewriteMode: 'VALUE_ALIAS',
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

  it('rewrites monthly conversion queries into Denodo-safe buckets and numeric casts', () => {
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
    expect(sql).toContain('CAST("orders_count" AS DECIMAL(18, 6))');
    expect(sql).toContain('CAST("leads_count" AS DECIMAL(18, 6))');
    expect(sql).toContain(
      'EXTRACT(YEAR FROM CAST("create_time" AS TIMESTAMP)) * 100 + EXTRACT(MONTH FROM CAST("create_time" AS TIMESTAMP)) AS "month"',
    );
    expect(sql).toContain(
      'EXTRACT(YEAR FROM CAST("dwd_ord_wife_det_h"."ord_create_time" AS TIMESTAMP)) * 100 + EXTRACT(MONTH FROM CAST("dwd_ord_wife_det_h"."ord_create_time" AS TIMESTAMP)) AS "month"',
    );
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
          concept: '订单履约状态',
          description: '订单状态字段，包含已完成等交付语义',
          aliases: ['已交付', '交付完成'],
          canonicalValue: '已完成',
          rewriteMode: 'VALUE_ALIAS',
        },
        {
          scope: {
            model: 'dim_city',
            column: 'city_name',
          },
          concept: '城市名称',
          aliases: ['城市'],
          rewriteMode: 'COLUMN_HINT',
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
          concept: '订单履约状态',
          aliases: ['已交付', '交付完成'],
          canonicalValue: '已完成',
          rewriteMode: 'VALUE_ALIAS',
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
