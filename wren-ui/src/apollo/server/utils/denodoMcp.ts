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

export type DenodoSemanticRewriteMode = 'COLUMN_HINT' | 'VALUE_ALIAS';

export interface DenodoSemanticDictionaryEntry {
  scope: {
    model: string;
    column: string;
  };
  concept: string;
  description?: string;
  aliases: string[];
  canonicalValue?: string | null;
  rewriteMode: DenodoSemanticRewriteMode;
}

export interface DenodoSemanticDictionary {
  version: string;
  generatedAt: string;
  entries: DenodoSemanticDictionaryEntry[];
}

export interface DenodoSemanticDictionaryTask {
  taskId: string;
  scope: {
    model: string;
    column: string;
  };
  rewriteMode: DenodoSemanticRewriteMode;
  columnType?: string;
  description?: string;
  modelDescription?: string;
}

export interface DenodoSemanticDictionaryBatchValueMapping {
  canonicalValue: string;
  aliases: string[];
  description?: string;
}

export interface DenodoSemanticDictionaryBatchItem {
  taskId: string;
  concept?: string;
  description?: string;
  aliases?: string[];
  valueMappings?: DenodoSemanticDictionaryBatchValueMapping[];
}

export interface DenodoSemanticDictionaryBatchResult {
  items: DenodoSemanticDictionaryBatchItem[];
}

export const buildDenodoMcpSchemaToolName = (databaseName: string) =>
  `denodo_${databaseName}_get_database_schema`;

export const buildDenodoMcpQueryToolName = (databaseName: string) =>
  `denodo_${databaseName}_run_sql_query`;

export const buildDenodoMcpValidateToolName = (databaseName: string) =>
  `denodo_${databaseName}_validate_sql_query`;

export const getDenodoSemanticDir = (projectId: number) =>
  path.join(config.persistCredentialDir, 'denodo-mcp', `${projectId}`);

export const getDenodoRawSchemaPath = (projectId: number) =>
  path.join(getDenodoSemanticDir(projectId), 'raw-schema.json');

export const getDenodoManifestPath = (projectId: number) =>
  path.join(getDenodoSemanticDir(projectId), 'manifest.json');

export const getDenodoSemanticDictionaryPath = (projectId: number) =>
  path.join(getDenodoSemanticDir(projectId), 'semantic-dictionary.json');

// Temporary kill switch until Denodo semantic dictionary quality is stable.
export const isDenodoSemanticDictionaryEnabled = () =>
  process.env.ENABLE_DENODO_SEMANTIC_DICTIONARY === 'true';

export const writeDenodoSemanticArtifacts = async ({
  projectId,
  rawSchema,
  manifest,
  semanticDictionary,
}: {
  projectId: number;
  rawSchema: Record<string, any>;
  manifest: Manifest;
  semanticDictionary?: DenodoSemanticDictionary | null;
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
  if (semanticDictionary) {
    await fs.promises.writeFile(
      getDenodoSemanticDictionaryPath(projectId),
      JSON.stringify(semanticDictionary, null, 2),
      'utf-8',
    );
  } else if (semanticDictionary === null) {
    await fs.promises
      .unlink(getDenodoSemanticDictionaryPath(projectId))
      .catch(() => undefined);
  }
};

export const writeDenodoSemanticDictionaryArtifact = async ({
  projectId,
  semanticDictionary,
}: {
  projectId: number;
  semanticDictionary?: DenodoSemanticDictionary | null;
}) => {
  const dir = getDenodoSemanticDir(projectId);
  await fs.promises.mkdir(dir, { recursive: true });
  if (semanticDictionary) {
    await fs.promises.writeFile(
      getDenodoSemanticDictionaryPath(projectId),
      JSON.stringify(semanticDictionary, null, 2),
      'utf-8',
    );
    return;
  }

  if (semanticDictionary === null) {
    await fs.promises
      .unlink(getDenodoSemanticDictionaryPath(projectId))
      .catch(() => undefined);
  }
};

export const readDenodoSemanticDictionary = async (
  projectId: number,
): Promise<DenodoSemanticDictionary | null> => {
  try {
    const raw = await fs.promises.readFile(
      getDenodoSemanticDictionaryPath(projectId),
      'utf-8',
    );
    return JSON.parse(raw) as DenodoSemanticDictionary;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

export const readDenodoRawSchema = async (
  projectId: number,
): Promise<Record<string, any>> => {
  const raw = await fs.promises.readFile(
    getDenodoRawSchemaPath(projectId),
    'utf-8',
  );
  return JSON.parse(raw);
};

export const readDenodoManifest = async (
  projectId: number,
): Promise<Manifest> => {
  const raw = await fs.promises.readFile(
    getDenodoManifestPath(projectId),
    'utf-8',
  );
  return JSON.parse(raw) as Manifest;
};

export const buildDenodoSemanticDictionary = (
  entries: DenodoSemanticDictionaryEntry[],
): DenodoSemanticDictionary => ({
  version: '1',
  generatedAt: new Date().toISOString(),
  entries,
});

const VALUE_ALIAS_CANDIDATE_PATTERNS = [
  /status/i,
  /state/i,
  /type/i,
  /level/i,
  /code/i,
  /flag/i,
  /^is_/i,
  /^has_/i,
  /状态/,
  /类型/,
  /级别/,
  /是否/,
  /渠道/,
  /来源/,
];

const COLUMN_HINT_CANDIDATE_PATTERNS = [
  ...VALUE_ALIAS_CANDIDATE_PATTERNS,
  /amount/i,
  /price/i,
  /date/i,
  /time/i,
  /city/i,
  /channel/i,
  /store/i,
  /customer/i,
  /order/i,
  /金额/,
  /价格/,
  /日期/,
  /时间/,
  /城市/,
  /渠道/,
  /门店/,
  /客户/,
  /订单/,
];

const MAX_VALUE_ALIAS_COLUMNS = 20;
const MAX_COLUMN_HINT_COLUMNS = 30;
const DEFAULT_DICTIONARY_BATCH_SIZE = 2;

type DenodoSemanticCandidateColumn = {
  model: string;
  modelDescription?: string;
  column: string;
  columnType?: string;
  description?: string;
  score: number;
  valueAliasCandidate: boolean;
  columnHintCandidate: boolean;
};

const toCandidateText = (...values: Array<string | undefined>) =>
  values.filter(Boolean).join(' ').trim();

const matchesAny = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value));

const humanizeIdentifier = (value: string) =>
  value
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();

const STATUS_VALUE_ALIAS_HEURISTICS: Record<string, string[]> = {
  已完成: ['已交付', '交付完成', '履约完成'],
  已支付: ['支付完成', '已付款', '付款完成'],
  待支付: ['未支付', '待付款'],
  已退款: ['退款完成', '已退单'],
  交付中: ['配送中', '履约中'],
  已锁单: ['已锁定'],
  是: ['true', '已开启'],
  否: ['false', '未开启'],
};

const extractDescriptionPrefix = (description?: string) => {
  if (!description) return undefined;
  return description
    .replace(/枚举值[:：].*$/u, '')
    .replace(/[。；;，,]\s*$/u, '')
    .trim();
};

const deriveConceptFromTask = (task: DenodoSemanticDictionaryTask) =>
  extractDescriptionPrefix(task.description) ||
  humanizeIdentifier(task.scope.column);

const splitEnumSegments = (value: string) =>
  value
    .split(/[，,；;、\n]+/u)
    .map((item) => item.trim().replace(/[。；;，,]+$/u, ''))
    .filter(Boolean);

const expandCanonicalAliases = (value: string) =>
  uniqueStrings([value, ...(STATUS_VALUE_ALIAS_HEURISTICS[value] || [])]);

const extractEnumMappingsFromDescription = (
  description?: string,
): DenodoSemanticDictionaryBatchValueMapping[] => {
  if (!description) return [];

  const enumMatch = description.match(/枚举值[:：]\s*(.+)$/u);
  if (!enumMatch?.[1]) return [];

  const segments = splitEnumSegments(enumMatch[1]);
  const mappings: DenodoSemanticDictionaryBatchValueMapping[] = [];

  segments.forEach((segment) => {
    const kvMatch = segment.match(
      /^\s*([A-Za-z0-9_-]+)\s*[=：:]\s*([^=：:]+?)\s*$/u,
    );
    if (kvMatch) {
      const canonicalValue = kvMatch[1].trim();
      const aliasLabel = kvMatch[2].trim();
      const aliases = expandCanonicalAliases(aliasLabel);
      if (canonicalValue && aliases.length) {
        mappings.push({
          canonicalValue,
          aliases,
        });
      }
      return;
    }

    if (/^[^=：:]+$/u.test(segment)) {
      const canonicalValue = segment.trim();
      const aliases = expandCanonicalAliases(canonicalValue);
      if (canonicalValue && aliases.length) {
        mappings.push({
          canonicalValue,
          aliases,
        });
      }
    }
  });

  return mappings;
};

const scoreCandidateColumn = ({
  column,
  description,
  valueAliasCandidate,
  columnHintCandidate,
}: {
  column: string;
  description?: string;
  valueAliasCandidate: boolean;
  columnHintCandidate: boolean;
}) => {
  let score = 0;
  if (description) score += 8;
  if (valueAliasCandidate) score += 10;
  if (columnHintCandidate) score += 4;
  if (/^is_/i.test(column) || /^has_/i.test(column)) score += 6;
  if (
    /status|state|type|amount|price|date|time|city|channel|customer|order/i.test(
      column,
    )
  ) {
    score += 5;
  }
  return score;
};

const collectDenodoSemanticCandidateColumns = ({
  manifest,
  rawSchema,
}: {
  manifest: Manifest;
  rawSchema: Record<string, any>;
}): DenodoSemanticCandidateColumn[] => {
  const rawViews =
    extractDenodoStructuredContent<DenodoDatabaseSchema>(rawSchema)?.views ||
    [];
  const rawViewMap = new Map(
    rawViews.map((view) => [view.view_name.toLowerCase(), view]),
  );

  return (manifest.models || [])
    .flatMap((model) => {
      const rawView = rawViewMap.get(model.name.toLowerCase());
      const rawColumnMap = new Map(
        (rawView?.columns || []).map((column) => [
          column.name.toLowerCase(),
          column,
        ]),
      );

      return (model.columns || []).map<DenodoSemanticCandidateColumn | null>(
        (column) => {
          const rawColumn = rawColumnMap.get(column.name.toLowerCase());
          const description =
            column.properties?.description || rawColumn?.description;
          const candidateText = toCandidateText(column.name, description);
          const valueAliasCandidate = matchesAny(
            candidateText,
            VALUE_ALIAS_CANDIDATE_PATTERNS,
          );
          const columnHintCandidate = matchesAny(
            candidateText,
            COLUMN_HINT_CANDIDATE_PATTERNS,
          );

          if (!valueAliasCandidate && !columnHintCandidate) {
            return null;
          }

          return {
            model: model.name,
            modelDescription: model.properties?.description,
            column: column.name,
            columnType: column.type,
            description,
            score: scoreCandidateColumn({
              column: column.name,
              description,
              valueAliasCandidate,
              columnHintCandidate,
            }),
            valueAliasCandidate,
            columnHintCandidate,
          };
        },
      );
    })
    .filter((item): item is DenodoSemanticCandidateColumn => !!item);
};

export const buildDenodoSemanticDictionaryTasks = ({
  manifest,
  rawSchema,
}: {
  manifest: Manifest;
  rawSchema: Record<string, any>;
}): DenodoSemanticDictionaryTask[] => {
  const candidates = collectDenodoSemanticCandidateColumns({
    manifest,
    rawSchema,
  });

  const valueAliasColumns = candidates
    .filter((candidate) => candidate.valueAliasCandidate)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_VALUE_ALIAS_COLUMNS);

  const valueAliasKeys = new Set(
    valueAliasColumns.map(
      (candidate) =>
        `${candidate.model.toLowerCase()}.${candidate.column.toLowerCase()}`,
    ),
  );

  const columnHintColumns = candidates
    .filter(
      (candidate) =>
        candidate.columnHintCandidate ||
        valueAliasKeys.has(
          `${candidate.model.toLowerCase()}.${candidate.column.toLowerCase()}`,
        ),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_COLUMN_HINT_COLUMNS);

  const tasks: DenodoSemanticDictionaryTask[] = [];
  const addTask = (
    candidate: DenodoSemanticCandidateColumn,
    rewriteMode: DenodoSemanticRewriteMode,
  ) => {
    tasks.push({
      taskId: `${candidate.model}.${candidate.column}.${rewriteMode}`,
      scope: {
        model: candidate.model,
        column: candidate.column,
      },
      rewriteMode,
      columnType: candidate.columnType,
      description: candidate.description,
      modelDescription: candidate.modelDescription,
    });
  };

  columnHintColumns.forEach((candidate) => addTask(candidate, 'COLUMN_HINT'));
  valueAliasColumns.forEach((candidate) => addTask(candidate, 'VALUE_ALIAS'));

  return tasks;
};

export const buildDenodoSemanticDictionaryBatches = (
  tasks: DenodoSemanticDictionaryTask[],
  batchSize = DEFAULT_DICTIONARY_BATCH_SIZE,
) => {
  const groupedByScope = tasks.reduce((acc, task) => {
    const key = `${task.scope.model}.${task.scope.column}`;
    const group = acc.get(key) || [];
    group.push(task);
    acc.set(key, group);
    return acc;
  }, new Map<string, DenodoSemanticDictionaryTask[]>());

  const groups = Array.from(groupedByScope.values());
  const batches: DenodoSemanticDictionaryTask[][] = [];
  for (let index = 0; index < groups.length; index += batchSize) {
    batches.push(groups.slice(index, index + batchSize).flat());
  }
  return batches;
};

export const buildDenodoSemanticDictionaryBatchContext = ({
  tasks,
  manifest,
  rawSchema,
}: {
  tasks: DenodoSemanticDictionaryTask[];
  manifest: Manifest;
  rawSchema: Record<string, any>;
}) => {
  const modelColumns = tasks.reduce((acc, task) => {
    const next = acc.get(task.scope.model) || new Set<string>();
    next.add(task.scope.column);
    acc.set(task.scope.model, next);
    return acc;
  }, new Map<string, Set<string>>());

  const manifestSummary = {
    models: (manifest.models || [])
      .filter((model) => modelColumns.has(model.name))
      .map((model) => {
        const selectedColumns =
          modelColumns.get(model.name) || new Set<string>();
        return {
          name: model.name,
          description: model.properties?.description,
          columns: (model.columns || [])
            .filter((column) => selectedColumns.has(column.name))
            .map((column) => ({
              name: column.name,
              type: column.type,
              description: column.properties?.description,
            })),
        };
      }),
  };

  const rawViews =
    extractDenodoStructuredContent<DenodoDatabaseSchema>(rawSchema)?.views ||
    [];
  const rawSchemaSummary = {
    views: rawViews
      .filter((view) => modelColumns.has(view.view_name))
      .map((view) => {
        const selectedColumns =
          modelColumns.get(view.view_name) || new Set<string>();
        return {
          view_name: view.view_name,
          description: view.description,
          columns: (view.columns || [])
            .filter((column) => selectedColumns.has(column.name))
            .map((column) => ({
              name: column.name,
              data_type: column.data_type,
              description: column.description,
            })),
        };
      }),
  };

  return {
    manifestSummary,
    rawSchemaSummary,
  };
};

const uniqueStrings = (values: Array<string | undefined | null>) =>
  Array.from(
    new Set(
      values
        .filter(
          (value): value is string => !!value && typeof value === 'string',
        )
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const normalizeBatchMappings = (item: Record<string, any>) => {
  if (Array.isArray(item.valueMappings)) {
    return item.valueMappings
      .filter((mapping) => mapping && typeof mapping === 'object')
      .map((mapping) => ({
        canonicalValue:
          typeof mapping.canonicalValue === 'string'
            ? mapping.canonicalValue.trim()
            : '',
        aliases: uniqueStrings(mapping.aliases || []),
        description:
          typeof mapping.description === 'string'
            ? mapping.description.trim()
            : undefined,
      }))
      .filter((mapping) => mapping.canonicalValue && mapping.aliases.length);
  }

  if (typeof item.canonicalValue === 'string') {
    const aliases = uniqueStrings(item.aliases || []);
    if (!aliases.length) return [];
    return [
      {
        canonicalValue: item.canonicalValue.trim(),
        aliases,
        description:
          typeof item.description === 'string'
            ? item.description.trim()
            : undefined,
      },
    ];
  }

  return [];
};

const findTaskForBatchItem = (
  item: Record<string, any>,
  taskMap: Map<string, DenodoSemanticDictionaryTask>,
) => {
  if (typeof item.taskId === 'string' && taskMap.has(item.taskId)) {
    return taskMap.get(item.taskId) || null;
  }

  if (
    typeof item.model === 'string' &&
    typeof item.column === 'string' &&
    typeof item.rewriteMode === 'string'
  ) {
    return (
      Array.from(taskMap.values()).find(
        (task) =>
          task.scope.model === item.model &&
          task.scope.column === item.column &&
          task.rewriteMode === item.rewriteMode,
      ) || null
    );
  }

  return null;
};

export const normalizeDenodoSemanticDictionaryEntries = ({
  tasks,
  result,
}: {
  tasks: DenodoSemanticDictionaryTask[];
  result: DenodoSemanticDictionaryBatchResult;
}): DenodoSemanticDictionaryEntry[] => {
  const taskMap = new Map(tasks.map((task) => [task.taskId, task]));
  const rawItems = Array.isArray(result?.items) ? result.items : [];
  const entries: DenodoSemanticDictionaryEntry[] = [];

  rawItems.forEach((item) => {
    const task = findTaskForBatchItem(item as Record<string, any>, taskMap);
    if (!task) return;

    const concept =
      typeof item.concept === 'string' && item.concept.trim()
        ? item.concept.trim()
        : humanizeIdentifier(task.scope.column);
    const description =
      typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : task.description;

    if (task.rewriteMode === 'COLUMN_HINT') {
      const aliases = uniqueStrings([...(item.aliases || []), concept]);
      entries.push({
        scope: task.scope,
        concept,
        description,
        aliases,
        rewriteMode: 'COLUMN_HINT',
      });
      return;
    }

    const mappings = normalizeBatchMappings(item as Record<string, any>);
    mappings.forEach((mapping) => {
      entries.push({
        scope: task.scope,
        concept,
        description: mapping.description || description,
        aliases: mapping.aliases,
        canonicalValue: mapping.canonicalValue,
        rewriteMode: 'VALUE_ALIAS',
      });
    });
  });

  return dedupeDenodoSemanticDictionaryEntries(entries);
};

export const buildFallbackDenodoSemanticDictionaryEntries = ({
  tasks,
  existingEntries = [],
}: {
  tasks: DenodoSemanticDictionaryTask[];
  existingEntries?: DenodoSemanticDictionaryEntry[];
}): DenodoSemanticDictionaryEntry[] => {
  const existingKeys = new Set(
    existingEntries.map(
      (entry) =>
        `${entry.scope.model}.${entry.scope.column}.${entry.rewriteMode}.${entry.canonicalValue || ''}`,
    ),
  );
  const fallbackEntries: DenodoSemanticDictionaryEntry[] = [];

  tasks.forEach((task) => {
    const baseKey = `${task.scope.model}.${task.scope.column}.${task.rewriteMode}.`;
    const concept = deriveConceptFromTask(task);
    const description = task.description || concept;

    if (task.rewriteMode === 'COLUMN_HINT') {
      if (existingKeys.has(baseKey)) {
        return;
      }
      fallbackEntries.push({
        scope: task.scope,
        concept,
        description,
        aliases: uniqueStrings([
          concept,
          humanizeIdentifier(task.scope.column),
        ]),
        rewriteMode: 'COLUMN_HINT',
      });
      return;
    }

    const mappings = extractEnumMappingsFromDescription(task.description);
    mappings.forEach((mapping) => {
      const mappingKey = `${task.scope.model}.${task.scope.column}.${task.rewriteMode}.${mapping.canonicalValue}`;
      if (existingKeys.has(mappingKey)) {
        return;
      }
      fallbackEntries.push({
        scope: task.scope,
        concept,
        description,
        aliases: mapping.aliases,
        canonicalValue: mapping.canonicalValue,
        rewriteMode: 'VALUE_ALIAS',
      });
    });
  });

  return dedupeDenodoSemanticDictionaryEntries(fallbackEntries);
};

export const dedupeDenodoSemanticDictionaryEntries = (
  entries: DenodoSemanticDictionaryEntry[],
) => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [
      entry.scope.model,
      entry.scope.column,
      entry.rewriteMode,
      entry.canonicalValue || '',
      uniqueStrings(entry.aliases).join('|'),
    ].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const toDenodoSemanticContext = (
  dictionary: DenodoSemanticDictionary | null | undefined,
  options?: {
    models?: string[];
    maxEntries?: number;
  },
): string | undefined => {
  if (!dictionary?.entries?.length) return undefined;

  const models =
    options?.models?.map((item) => item.toLowerCase()).filter(Boolean) || [];
  const maxEntries = options?.maxEntries || 60;
  const prioritizedEntries = dictionary.entries
    .filter((entry) => {
      if (!models.length) return true;
      return models.includes(entry.scope.model.toLowerCase());
    })
    .sort((left, right) => {
      if (left.rewriteMode === right.rewriteMode) return 0;
      return left.rewriteMode === 'VALUE_ALIAS' ? -1 : 1;
    })
    .slice(0, maxEntries);

  if (!prioritizedEntries.length) return undefined;

  return prioritizedEntries
    .map((entry) => {
      const scope = `${entry.scope.model}.${entry.scope.column}`;
      const aliases = entry.aliases.join(', ');
      const canonical = entry.canonicalValue
        ? ` | canonical: ${entry.canonicalValue}`
        : '';
      const description = entry.description
        ? ` | description: ${entry.description}`
        : '';
      return `- scope: ${scope} | concept: ${entry.concept} | rewriteMode: ${entry.rewriteMode}${canonical} | aliases: ${aliases}${description}`;
    })
    .join('\n');
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

export const filterDenodoRawSchemaViews = (
  rawSchema: Record<string, any>,
  selectedViews: string[],
): Record<string, any> => {
  const structured =
    extractDenodoStructuredContent<DenodoDatabaseSchema>(rawSchema);
  const views = structured?.views || [];
  const selectedViewSet = new Set(
    selectedViews.map((view) => view.toLowerCase()),
  );
  const filteredStructured = {
    ...structured,
    views: views.filter((view) =>
      selectedViewSet.has(view.view_name.toLowerCase()),
    ),
  };

  const nextRawSchema: Record<string, any> = {
    ...rawSchema,
    structuredContent: filteredStructured,
  };
  if (Array.isArray(rawSchema?.content)) {
    nextRawSchema.content = rawSchema.content.map((item) =>
      item?.type === 'text'
        ? { ...item, text: JSON.stringify(filteredStructured) }
        : item,
    );
  }

  return nextRawSchema;
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
  modelName: string;
  table: string;
  columns: Map<string, string>;
};

type StatementScope = {
  tables: Map<string, ManifestModelInfo | null>;
  selectAliases: Set<string>;
};

type DateBucketUnit = 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY';

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

const cloneNode = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const getFunctionName = (expr: any) =>
  expr?.name?.name
    ?.map((part: { value?: string }) => part?.value)
    ?.join('.')
    ?.toUpperCase?.();

const getFunctionArguments = (expr: any) =>
  Array.isArray(expr?.args?.value) ? expr.args.value : [];

const getAggregateName = (expr: any) => `${expr?.name || ''}`.toUpperCase();

const buildNumberNode = (value: number) => ({
  type: 'number',
  value,
});

const buildBinaryExpr = (left: any, operator: string, right: any) => ({
  type: 'binary_expr',
  operator,
  left,
  right,
});

const buildExtractExpr = (field: string, source: any) => ({
  type: 'extract',
  args: {
    field,
    cast_type: null,
    source,
  },
});

const buildCaseExpr = (
  conditions: { cond: any; result: any }[],
  elseResult: any,
) => ({
  type: 'case',
  expr: null,
  args: [
    ...conditions.map(({ cond, result }) => ({
      type: 'when',
      cond,
      result,
    })),
    {
      type: 'else',
      result: elseResult,
    },
  ],
});

const buildCoalesceExpr = (...args: any[]) => ({
  type: 'function',
  name: {
    name: [
      {
        type: 'default',
        value: 'COALESCE',
      },
    ],
  },
  args: {
    type: 'expr_list',
    value: args,
  },
});

const buildDecimalTarget = (scale = 6) => [
  {
    dataType: 'DECIMAL',
    length: 18,
    scale,
    parentheses: true,
    suffix: [],
  },
];

const buildCastExpr = (expr: any, target: any[]) => ({
  type: 'cast',
  keyword: 'cast',
  expr,
  symbol: 'as',
  target,
});

const buildDateBucketExpr = (unit: DateBucketUnit, source: any) => {
  const buildSource = () => cloneNode(source);
  const yearExpr = () => buildExtractExpr('YEAR', buildSource());

  switch (unit) {
    case 'YEAR':
      return yearExpr();
    case 'MONTH':
      return buildBinaryExpr(
        buildBinaryExpr(yearExpr(), '*', buildNumberNode(100)),
        '+',
        buildExtractExpr('MONTH', buildSource()),
      );
    case 'DAY':
      return buildBinaryExpr(
        buildBinaryExpr(
          buildBinaryExpr(yearExpr(), '*', buildNumberNode(10000)),
          '+',
          buildBinaryExpr(
            buildExtractExpr('MONTH', buildSource()),
            '*',
            buildNumberNode(100),
          ),
        ),
        '+',
        buildExtractExpr('DAY', buildSource()),
      );
    case 'QUARTER':
      return buildBinaryExpr(
        buildBinaryExpr(yearExpr(), '*', buildNumberNode(10)),
        '+',
        buildCaseExpr(
          [
            {
              cond: buildBinaryExpr(
                buildExtractExpr('MONTH', buildSource()),
                '<=',
                buildNumberNode(3),
              ),
              result: buildNumberNode(1),
            },
            {
              cond: buildBinaryExpr(
                buildExtractExpr('MONTH', buildSource()),
                '<=',
                buildNumberNode(6),
              ),
              result: buildNumberNode(2),
            },
            {
              cond: buildBinaryExpr(
                buildExtractExpr('MONTH', buildSource()),
                '<=',
                buildNumberNode(9),
              ),
              result: buildNumberNode(3),
            },
          ],
          buildNumberNode(4),
        ),
      );
  }
};

const getDateBucketUnit = (value?: string): DateBucketUnit | null => {
  switch (`${value || ''}`.toUpperCase()) {
    case 'YEAR':
      return 'YEAR';
    case 'QUARTER':
      return 'QUARTER';
    case 'MONTH':
      return 'MONTH';
    case 'DAY':
      return 'DAY';
    default:
      return null;
  }
};

const normalizeCastTarget = (target: any) => {
  const dataType = `${target?.dataType || ''}`.toUpperCase();

  if (
    dataType === 'TIMESTAMP' &&
    Array.isArray(target?.suffix) &&
    target.suffix.join(' ').toUpperCase() === 'WITH TIME ZONE'
  ) {
    return {
      ...target,
      suffix: [],
    };
  }

  if (['DOUBLE', 'FLOAT', 'REAL', 'NUMBER'].includes(dataType)) {
    return buildDecimalTarget()[0];
  }

  return target;
};

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
          modelName: model.name,
          table: model.tableReference?.table || model.name,
          columns,
        },
      ] satisfies [string, ManifestModelInfo];
    }),
  );
};

type SemanticDictionaryRewriteResult = {
  sql: string;
  appliedRewrites: string[];
};

export const applySemanticDictionaryToSql = (
  sql: string,
  manifest: Manifest,
  dictionary: DenodoSemanticDictionary | null | undefined,
): SemanticDictionaryRewriteResult => {
  if (!dictionary?.entries?.length) {
    return { sql, appliedRewrites: [] };
  }

  const appliedRewrites: string[] = [];
  try {
    const ast = parser.astify(sql, { database: 'postgresql' });
    const modelMap = buildManifestModelMap(manifest);
    const dictionaryMap = buildSemanticDictionaryMap(dictionary.entries);

    const rewriteLiteral = (expr: any, scope: StatementScope): any => {
      if (!expr || typeof expr !== 'object') return expr;

      if (expr.type === 'binary_expr') {
        expr.left = rewriteLiteral(expr.left, scope);
        expr.right = rewriteLiteral(expr.right, scope);

        const leftMatch = tryRewritePredicate(
          expr.left,
          expr.right,
          expr.operator,
          scope,
          dictionaryMap,
          appliedRewrites,
        );
        if (leftMatch) {
          expr.left = leftMatch.columnExpr;
          expr.operator = leftMatch.operator;
          expr.right = leftMatch.literal;
          return expr;
        }

        const rightMatch = tryRewritePredicate(
          expr.right,
          expr.left,
          expr.operator,
          scope,
          dictionaryMap,
          appliedRewrites,
        );
        if (rightMatch) {
          expr.operator = rightMatch.operator;
          expr.right = rightMatch.columnExpr;
          expr.left = rightMatch.literal;
          return expr;
        }
        return expr;
      }

      if (expr.type === 'select') {
        return rewriteSelectLiterals(expr);
      }

      Object.values(expr).forEach((value) => {
        if (Array.isArray(value)) {
          value.forEach((item) => rewriteLiteral(item, scope));
        } else if (value && typeof value === 'object') {
          rewriteLiteral(value, scope);
        }
      });
      return expr;
    };

    const rewriteFromItem = (item: any, scope: StatementScope) => {
      if (!item || typeof item !== 'object') return;

      if (item.expr?.ast || item.expr?.type === 'select') {
        rewriteSelectLiterals(item.expr?.ast || item.expr);
        if (item.as) {
          scope.tables.set(item.as, null);
        }
        return;
      }

      const matchedModel =
        modelMap.get(item.table) ||
        Array.from(modelMap.values()).find(
          (candidate) => candidate.table === item.table,
        );

      const alias = item.as || item.table;
      scope.tables.set(alias, matchedModel || null);

      if (item.on) {
        rewriteLiteral(item.on, scope);
      }
    };

    const rewriteSelectLiterals = (statement: any) => {
      if (!statement || typeof statement !== 'object') return statement;

      const scope: StatementScope = {
        tables: new Map(),
        selectAliases: new Set(),
      };

      (statement.with || []).forEach((cte) => {
        if (cte?.stmt) {
          rewriteSelectLiterals(cte.stmt);
        }
      });

      (statement.from || []).forEach((item) => rewriteFromItem(item, scope));
      (statement.columns || []).forEach((column) => {
        if (column?.as) {
          scope.selectAliases.add(column.as);
        }
      });

      rewriteLiteral(statement.where, scope);
      rewriteLiteral(statement.having, scope);

      if (statement._next) {
        rewriteSelectLiterals(statement._next);
      }

      return statement;
    };

    const rewrittenAst = Array.isArray(ast)
      ? ast.map((statement) => rewriteSelectLiterals(statement))
      : rewriteSelectLiterals(ast);

    return {
      sql: parser.sqlify(rewrittenAst, { database: 'postgresql' }),
      appliedRewrites,
    };
  } catch {
    return { sql, appliedRewrites: [] };
  }
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
      expr.expr = rewriteExpression(expr.expr, scope);
      expr.target = expr.target.map((target: any) =>
        normalizeCastTarget(target),
      );
      return expr;
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

      const bucketUnit =
        args[0]?.type === 'single_quote_string'
          ? getDateBucketUnit(args[0].value)
          : null;
      if (
        ['DATE_TRUNC', 'DATETRUNC'].includes(functionName) &&
        args.length === 2 &&
        bucketUnit
      ) {
        return replaceNode(
          expr,
          buildDateBucketExpr(bucketUnit, rewriteExpression(args[1], scope)),
        );
      }

      if (functionName === 'TO_NUMBER' && args.length === 1) {
        return replaceNode(expr, {
          ...buildCastExpr(
            rewriteExpression(args[0], scope),
            buildDecimalTarget(2),
          ),
        });
      }
    }

    if (
      expr.type === 'aggr_func' &&
      getAggregateName(expr) === 'SUM' &&
      !expr.over
    ) {
      if (expr.args?.expr) {
        expr.args.expr = rewriteExpression(expr.args.expr, scope);
      } else if (expr.args?.value) {
        expr.args.value = rewriteExpression(expr.args.value, scope);
      }

      return replaceNode(
        expr,
        buildCoalesceExpr(cloneNode(expr), buildNumberNode(0)),
      );
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
      if (item.join === 'FULL JOIN') {
        item.join = 'FULL OUTER JOIN';
      }
      return;
    }

    const alias = item.as || originalTable;
    scope.tables.set(alias, matchedModel);

    if (matchedModel.table !== originalTable) {
      item.table = matchedModel.table;
      item.as = alias;
    }

    if (item.join === 'FULL JOIN') {
      item.join = 'FULL OUTER JOIN';
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

const buildSemanticDictionaryMap = (
  entries: DenodoSemanticDictionaryEntry[],
) => {
  return entries.reduce((acc, entry) => {
    const key = `${entry.scope.model.toLowerCase()}.${entry.scope.column.toLowerCase()}`;
    const nextEntries = [...(acc.get(key) || []), entry];
    acc.set(key, nextEntries);
    return acc;
  }, new Map<string, DenodoSemanticDictionaryEntry[]>());
};

const tryRewritePredicate = (
  columnExpr: any,
  literalExpr: any,
  operator: string,
  scope: StatementScope,
  dictionaryMap: Map<string, DenodoSemanticDictionaryEntry[]>,
  appliedRewrites: string[],
): { operator: string; literal: any; columnExpr: any } | null => {
  const normalizedOperator = `${operator || ''}`.toUpperCase();
  if (!['=', 'LIKE', 'IN'].includes(normalizedOperator)) {
    return null;
  }

  const normalizedColumnExpr = unwrapLowerFunction(columnExpr);
  const resolvedScope = resolveSemanticScope(normalizedColumnExpr, scope);
  if (!resolvedScope) return null;

  const entries =
    dictionaryMap.get(
      `${resolvedScope.model.toLowerCase()}.${resolvedScope.column.toLowerCase()}`,
    ) || [];

  if (
    normalizedOperator === 'IN' &&
    literalExpr?.type === 'expr_list' &&
    Array.isArray(literalExpr?.value)
  ) {
    let unresolved = false;
    const rewriteLogs: string[] = [];
    const rewrittenValues = literalExpr.value.map((item: any) => {
      const rawLiteral = getStringLiteralValue(item);
      if (!rawLiteral) return { original: item, next: item, rewritten: false };
      const alreadyCanonical = entries.some(
        (entry) =>
          entry.rewriteMode === 'VALUE_ALIAS' &&
          entry.canonicalValue === rawLiteral,
      );
      if (alreadyCanonical) {
        return { original: item, next: item, rewritten: false };
      }
      const matchedEntry = matchSemanticEntry(entries, rawLiteral, '=');
      if (!matchedEntry?.canonicalValue) {
        unresolved = true;
        return { original: item, next: item, rewritten: false };
      }
      if (matchedEntry.canonicalValue === rawLiteral) {
        return { original: item, next: item, rewritten: false };
      }
      rewriteLogs.push(
        `apply semantic rewrite: ${resolvedScope.model}.${resolvedScope.column}: ${rawLiteral} -> ${matchedEntry.canonicalValue}`,
      );
      return {
        original: item,
        next: {
          type: 'single_quote_string',
          value: matchedEntry.canonicalValue,
        },
        rewritten: true,
      };
    });

    if (unresolved || !rewrittenValues.some((item) => item.rewritten)) {
      return null;
    }

    appliedRewrites.push(...rewriteLogs);

    return {
      operator: 'IN',
      columnExpr: cloneNode(normalizedColumnExpr),
      literal: {
        ...literalExpr,
        value: rewrittenValues.map((item) => item.next),
      },
    };
  }

  const literalValue = getStringLiteralValue(literalExpr);
  if (!literalValue) return null;
  const normalizedLiteralValue =
    normalizedOperator === 'LIKE'
      ? trimLikePattern(literalValue)
      : literalValue;

  const matchedEntry = matchSemanticEntry(
    entries,
    literalValue,
    normalizedOperator,
  );
  if (!matchedEntry?.canonicalValue) return null;

  if (matchedEntry.canonicalValue === normalizedLiteralValue) {
    return null;
  }

  appliedRewrites.push(
    `apply semantic rewrite: ${resolvedScope.model}.${resolvedScope.column}: ${normalizedLiteralValue} -> ${matchedEntry.canonicalValue}`,
  );

  return {
    operator: '=',
    columnExpr: cloneNode(normalizedColumnExpr),
    literal: {
      type: 'single_quote_string',
      value: matchedEntry.canonicalValue,
    },
  };
};

const resolveSemanticScope = (
  expr: any,
  scope: StatementScope,
): { model: string; column: string } | null => {
  if (expr?.type !== 'column_ref') return null;

  const columnName =
    typeof expr.column === 'string'
      ? expr.column
      : expr.column?.expr?.value || expr.column?.value;
  if (!columnName) return null;

  const tableName =
    typeof expr.table === 'string' ? expr.table : expr.table?.value;

  if (tableName) {
    const matchedModel = scope.tables.get(tableName);
    if (matchedModel?.columns.has(columnName)) {
      return {
        model: matchedModel.modelName,
        column: columnName,
      };
    }
  }

  const matchedModels = Array.from(scope.tables.values()).filter(
    (table): table is ManifestModelInfo =>
      !!table && table.columns.has(columnName),
  );
  if (matchedModels.length !== 1) return null;

  return {
    model: matchedModels[0].modelName,
    column: columnName,
  };
};

const getStringLiteralValue = (expr: any) => {
  const normalizedExpr = unwrapLowerFunction(expr);
  if (!normalizedExpr || typeof normalizedExpr !== 'object') return null;
  if (normalizedExpr.type !== 'single_quote_string') return null;
  return `${normalizedExpr.value || ''}`.trim();
};

const unwrapLowerFunction = (expr: any) => {
  if (!expr || typeof expr !== 'object') return expr;

  if (expr.type === 'function' && getFunctionName(expr) === 'LOWER') {
    const args = getFunctionArguments(expr);
    if (args.length === 1) {
      return args[0];
    }
  }

  return expr;
};

const normalizeSemanticAlias = (value: string) => value.trim().toLowerCase();

const trimLikePattern = (value: string) => {
  if (!value.includes('%')) return value;
  const trimmed = value.replace(/^%+|%+$/g, '').trim();
  return trimmed || value;
};

const matchSemanticEntry = (
  entries: DenodoSemanticDictionaryEntry[],
  rawValue: string,
  operator: string,
) => {
  const candidateValue = normalizeSemanticAlias(
    operator === 'LIKE' ? trimLikePattern(rawValue) : rawValue,
  );
  if (!candidateValue) return null;

  const matchedEntries = entries.filter((entry) => {
    if (entry.rewriteMode !== 'VALUE_ALIAS' || !entry.canonicalValue) {
      return false;
    }
    return entry.aliases.some(
      (alias) => normalizeSemanticAlias(alias) === candidateValue,
    );
  });

  if (matchedEntries.length !== 1) {
    return null;
  }

  return matchedEntries[0];
};
