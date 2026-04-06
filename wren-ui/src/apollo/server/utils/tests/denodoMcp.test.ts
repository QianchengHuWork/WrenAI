import { Manifest } from '@server/mdl/type';
import {
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
      /SUM\(CAST\("dwd_ord_wife_det_h"\."actual_price" AS DECIMAL\(\s*18,\s*2\s*\)\)\) AS "total_amount"/,
    );
    expect(sql).toContain(
      'EXTRACT(YEAR FROM CAST("dwd_ord_wife_det_h"."ord_create_time" AS TIMESTAMP)) = 2026',
    );
    expect(sql).not.toContain('DATE_PART');
    expect(sql).not.toContain('TO_NUMBER');
  });
});
