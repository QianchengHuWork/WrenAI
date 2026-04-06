import * as fs from 'fs';
import path from 'path';
import { Parser } from 'node-sql-parser';
import { getConfig } from '@server/config';
import { Manifest } from '@server/mdl/type';
import { CompactColumn, CompactTable } from '@server/services/metadataService';
import * as Errors from '@server/utils/error';

const parser = new Parser();
const config = getConfig();

export interface DenodoSchemaColumn {
  name: string;
  data_type?: string;
  description?: string;
}

export interface DenodoSchemaView {
  view_name: string;
  description?: string;
  columns?: DenodoSchemaColumn[];
  schema?: string;
  catalog?: string;
  primary_key?: string | string[];
}

export interface DenodoDatabaseSchema {
  views?: DenodoSchemaView[];
}

export const buildDenodoMcpSchemaToolName = (databaseName: string) =>
  `denodo_${databaseName}_get_database_schema`;

export const buildDenodoMcpQueryToolName = (databaseName: string) =>
  `denodo_${databaseName}_run_sql_query`;

export const getDenodoSemanticDir = (projectId: number) =>
  path.join(config.persistCredentialDir, 'denodo-mcp', `${projectId}`);

export const getDenodoRawSchemaPath = (projectId: number) =>
  path.join(getDenodoSemanticDir(projectId), 'raw-schema.json');

export const getDenodoManifestPath = (projectId: number) =>
  path.join(getDenodoSemanticDir(projectId), 'manifest.json');

export const writeDenodoSemanticArtifacts = async ({
  projectId,
  rawSchema,
  manifest,
}: {
  projectId: number;
  rawSchema: Record<string, any>;
  manifest: Manifest;
}) => {
  const dir = getDenodoSemanticDir(projectId);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    getDenodoRawSchemaPath(projectId),
    JSON.stringify(rawSchema, null, 2),
    'utf-8',
  );
  await fs.promises.writeFile(
    getDenodoManifestPath(projectId),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );
};

export const extractDenodoStructuredContent = <T = any>(
  toolResult: Record<string, any>,
): T => {
  if (toolResult?.structuredContent) {
    return toolResult.structuredContent as T;
  }

  const textContent = toolResult?.content?.find(
    (item) => item?.type === 'text' && typeof item?.text === 'string',
  )?.text;
  if (!textContent) {
    return {} as T;
  }

  try {
    return JSON.parse(textContent) as T;
  } catch {
    return {} as T;
  }
};

export const toDenodoCompactTables = (
  rawSchema: Record<string, any>,
): CompactTable[] => {
  const schema =
    extractDenodoStructuredContent<DenodoDatabaseSchema>(rawSchema);
  const views = schema?.views || [];

  return views.map((view) => {
    const columns = (view.columns || []).map<CompactColumn>((column) => ({
      name: column.name,
      type: normalizeSemanticType(column.data_type),
      notNull: false,
      description: column.description,
      properties: column.description
        ? { description: column.description }
        : undefined,
    }));

    return {
      name: view.view_name,
      columns,
      description: view.description,
      properties: {
        table: view.view_name,
        ...(view.schema ? { schema: view.schema } : {}),
        ...(view.catalog ? { catalog: view.catalog } : {}),
        ...(view.description ? { description: view.description } : {}),
      },
      primaryKey: Array.isArray(view.primary_key)
        ? view.primary_key[0]
        : view.primary_key,
    };
  });
};

export const toDenodoPreviewData = (
  toolResult: Record<string, any>,
): { columns: { name: string; type: string }[]; data: any[][] } => {
  const structured = extractDenodoStructuredContent(toolResult) as Record<
    string,
    any
  >;
  const rows: Record<string, unknown>[] = Array.isArray(structured?.data)
    ? structured.data.filter(isRecord)
    : [];
  const columnNames = rows.length
    ? Array.from(
        rows.reduce((acc, row) => {
          Object.keys(row).forEach((key) => acc.add(key));
          return acc;
        }, new Set<string>()),
      )
    : [];

  const columns = columnNames.map((name) => ({
    name,
    type: inferDataType(rows, name),
  }));

  return {
    columns,
    data: rows.map((row) => columnNames.map((name) => row?.[name] ?? null)),
  };
};

export const toDenodoNativeSql = (sql: string, manifest: Manifest): string => {
  try {
    const ast = parser.astify(sql, { database: 'postgresql' });
    const rewrittenAst = rewriteAst(ast, manifest);
    return parser.sqlify(rewrittenAst, { database: 'postgresql' });
  } catch (error: any) {
    throw Errors.create(Errors.GeneralErrorCodes.INVALID_SQL_ERROR, {
      customMessage: `Failed to convert Wren SQL to Denodo SQL: ${error.message}`,
      originalError: error,
    });
  }
};

const normalizeSemanticType = (dataType?: string) => {
  const normalized = (dataType || 'string').toUpperCase();
  if (normalized.includes('BOOL')) return 'boolean';
  if (normalized.includes('INT')) return 'integer';
  if (
    ['DECIMAL', 'NUMERIC', 'DOUBLE', 'FLOAT', 'REAL', 'NUMBER'].some((item) =>
      normalized.includes(item),
    )
  ) {
    return 'number';
  }
  if (normalized.includes('DATE') || normalized.includes('TIME')) {
    return 'timestamp';
  }
  return 'string';
};

const inferDataType = (rows: Record<string, unknown>[], columnName: string) => {
  const value = rows
    .map((row) => row?.[columnName])
    .find((candidate) => candidate !== null && candidate !== undefined);
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
};

type ManifestModelInfo = {
  table: string;
  columns: Map<string, string>;
};

type StatementScope = {
  tables: Map<string, ManifestModelInfo | null>;
  selectAliases: Set<string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const replaceNode = (
  target: Record<string, any>,
  next: Record<string, any>,
) => {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, next);
  return target;
};

const getFunctionName = (expr: any) =>
  expr?.name?.name
    ?.map((part: { value?: string }) => part?.value)
    ?.join('.')
    ?.toUpperCase?.();

const getFunctionArguments = (expr: any) =>
  Array.isArray(expr?.args?.value) ? expr.args.value : [];

const buildManifestModelMap = (manifest: Manifest) => {
  return new Map(
    (manifest.models || []).map((model) => {
      const columns = new Map(
        (model.columns || []).map((column) => [
          column.name,
          getPhysicalColumnName(column),
        ]),
      );
      return [
        model.name,
        {
          table: model.tableReference?.table || model.name,
          columns,
        },
      ] satisfies [string, ManifestModelInfo];
    }),
  );
};

const getPhysicalColumnName = (column: {
  name: string;
  expression?: string;
}) => {
  if (!column.expression) {
    return column.name;
  }
  const matched = column.expression.match(/^"(.+)"$/);
  return matched?.[1] || column.name;
};

const rewriteAst = (ast: any, manifest: Manifest): any => {
  const modelMap = buildManifestModelMap(manifest);

  const rewriteExpression = (expr: any, scope: StatementScope) => {
    if (!expr || typeof expr !== 'object') {
      return expr;
    }

    if (expr.type === 'cast' && Array.isArray(expr.target)) {
      expr.target = expr.target.map((target: any) => {
        if (
          target?.dataType === 'TIMESTAMP' &&
          Array.isArray(target?.suffix) &&
          target.suffix.join(' ').toUpperCase() === 'WITH TIME ZONE'
        ) {
          return {
            ...target,
            suffix: [],
          };
        }
        return target;
      });
    }

    if (expr.type === 'function') {
      const functionName = getFunctionName(expr);
      const args = getFunctionArguments(expr);

      if (
        functionName === 'DATE_PART' &&
        args.length === 2 &&
        args[0]?.type === 'single_quote_string'
      ) {
        return replaceNode(expr, {
          type: 'extract',
          args: {
            field: `${args[0].value || ''}`.toUpperCase(),
            cast_type: null,
            source: rewriteExpression(args[1], scope),
          },
        });
      }

      if (functionName === 'TO_NUMBER' && args.length === 1) {
        return replaceNode(expr, {
          type: 'cast',
          keyword: 'cast',
          expr: rewriteExpression(args[0], scope),
          symbol: 'as',
          target: [
            {
              dataType: 'DECIMAL',
              length: 18,
              scale: 2,
              parentheses: true,
              suffix: [],
            },
          ],
        });
      }
    }

    if (expr.type === 'column_ref') {
      const columnName =
        typeof expr.column === 'string'
          ? expr.column
          : expr.column?.expr?.value || expr.column?.value;
      const tableName = expr.table;
      const matchedTable = tableName ? scope.tables.get(tableName) : null;

      if (matchedTable) {
        const sourceColumn = matchedTable.columns.get(columnName);
        if (sourceColumn) {
          expr.column = toQuotedColumnNode(sourceColumn);
        }
        return expr;
      }

      if (!tableName && !scope.selectAliases.has(columnName)) {
        const matchedModels = Array.from(scope.tables.values()).filter(
          (table): table is ManifestModelInfo =>
            !!table && table.columns.has(columnName),
        );
        if (matchedModels.length === 1) {
          const sourceColumn = matchedModels[0].columns.get(columnName);
          expr.column = toQuotedColumnNode(sourceColumn || columnName);
        } else {
          expr.column = toQuotedColumnNode(columnName);
        }
      } else {
        expr.column = toQuotedColumnNode(columnName);
      }
      return expr;
    }

    if (expr.type === 'select') {
      return rewriteSelect(expr, modelMap);
    }

    Object.values(expr).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((item) => rewriteExpression(item, scope));
      } else if (value && typeof value === 'object') {
        rewriteExpression(value, scope);
      }
    });
    return expr;
  };

  const rewriteFromItem = (item: any, scope: StatementScope) => {
    if (!item || typeof item !== 'object') return;

    if (item.expr?.ast || item.expr?.type === 'select') {
      const subquery = item.expr?.ast || item.expr;
      rewriteSelect(subquery, modelMap);
      return;
    }

    const originalTable = item.table;
    const matchedModel = modelMap.get(originalTable);
    if (!matchedModel) {
      if (item.as) {
        scope.tables.set(item.as, null);
      }
      return;
    }

    const alias = item.as || originalTable;
    scope.tables.set(alias, matchedModel);

    if (matchedModel.table !== originalTable) {
      item.table = matchedModel.table;
      item.as = alias;
    }

    if (item.on) {
      rewriteExpression(item.on, scope);
    }
  };

  const rewriteSelect = (
    statement: any,
    currentModelMap: Map<string, ManifestModelInfo>,
  ) => {
    if (!statement || typeof statement !== 'object') return statement;

    // Denodo MCP validator is fragile around LIMIT/FETCH/TOP, so truncate rows
    // in the service layer after execution instead of relying on SQL pagination.
    statement.limit = null;

    const scope: StatementScope = {
      tables: new Map(),
      selectAliases: new Set(),
    };

    (statement.with || []).forEach((cte) => {
      if (cte?.stmt) {
        rewriteSelect(cte.stmt, currentModelMap);
      }
    });

    (statement.from || []).forEach((item) => rewriteFromItem(item, scope));

    (statement.columns || []).forEach((column) => {
      if (column?.as) {
        scope.selectAliases.add(column.as);
      }
      rewriteExpression(column?.expr, scope);
    });

    rewriteExpression(statement.where, scope);
    rewriteExpression(statement.having, scope);
    (statement.groupby?.columns || []).forEach((column) =>
      rewriteExpression(column, scope),
    );
    (statement.orderby || []).forEach((item) =>
      rewriteExpression(item?.expr, scope),
    );
    (statement.window || []).forEach((item) => rewriteExpression(item, scope));

    if (statement._next) {
      rewriteSelect(statement._next, currentModelMap);
    }

    return statement;
  };

  if (Array.isArray(ast)) {
    return ast.map((statement) => rewriteSelect(statement, modelMap));
  }
  return rewriteSelect(ast, modelMap);
};

const toQuotedColumnNode = (columnName: string) => ({
  expr: {
    type: 'double_quote_string',
    value: columnName,
  },
});
