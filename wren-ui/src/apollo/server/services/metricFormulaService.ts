import * as fs from 'fs';
import path from 'path';
import type {
  MetricFormula,
  MetricFormulaMetric,
  MetricFormulaStore,
} from '@server/models/metricFormula';

export interface IMetricFormulaService {
  getFilePath(): string;
  listFormulas(): Promise<MetricFormula[]>;
  listEnabledFormulas(): Promise<MetricFormula[]>;
  createFormula(input: Partial<MetricFormula>): Promise<MetricFormula>;
  updateFormula(
    id: string,
    input: Partial<MetricFormula>,
  ): Promise<MetricFormula>;
  deleteFormula(id: string): Promise<void>;
}

const STORE_VERSION = 1;
const STORE_FILE_NAME = 'metric-formulas.json';

const nowIso = () => new Date().toISOString();

const DEFAULT_ASSIGN_CONVERSION_FORMULA: MetricFormula = {
  id: 'denodo_assign_total_conversion',
  enabled: true,
  dataSource: 'denodo',
  name: '智能分配转化指标',
  description: '智能分配线索数、订单数、转化率、转化订单金额',
  scope: {
    primaryModel: 'dv_assign_total_conversion_core',
    requiredModels: [],
  },
  match: {
    triggerPhrases: ['智能分配', '分配策略', '智能分配转化', '转化订单金额'],
    exampleQuestions: [],
  },
  metrics: [
    {
      name: 'clew_count',
      expression: 'COUNT(DISTINCT "clew_id")',
    },
    {
      name: 'order_count',
      expression:
        'COUNT(DISTINCT CASE WHEN "is_ord_fdpay" = 1 THEN "biz_order_no" END)',
    },
    {
      name: 'conversion_rate',
      expression:
        'ROUND(COUNT(DISTINCT CASE WHEN "is_ord_fdpay" = 1 THEN "biz_order_no" END) * 100.0 / NULLIF(COUNT(DISTINCT "clew_id"), 0), 2)',
    },
    {
      name: 'total_amount',
      expression:
        'COALESCE(SUM(CASE WHEN "is_ord_fdpay" = 1 THEN "actual_price" END), 0)',
    },
  ],
  forbiddenPatterns: [
    'COUNT(*)',
    'is_ord_pay',
    'SUM(CASE WHEN ... THEN 1 ELSE 0 END)',
    'converted_order_count / assigned_clew_count',
  ],
  extraInstruction:
    '智能分配转化率不要使用 converted_order_count / assigned_clew_count，也不要改用 dv_clew_ord_conversion_core。',
};

const DEFAULT_CLEW_OVERVIEW_CONVERSION_FORMULA: MetricFormula = {
  id: 'denodo_clew_overview_conversion',
  enabled: true,
  dataSource: 'denodo',
  name: '线索大盘转化指标',
  description:
    '线索大盘线索量、订单数、订单转化率、转化订单金额，按商机 niche_id 做线索到订单归因。',
  scope: {
    primaryModel: 'dv_clew_core',
    requiredModels: ['dv_ord_core'],
  },
  match: {
    triggerPhrases: [
      '线索大盘',
      '全量线索',
      '线索转化效果',
      '线索订单转化',
      '大定支付转化率',
      '商机转化分析',
      '线索转化归因',
      '转化订单金额',
      '线索四级来源目录',
      '来源渠道转化率',
    ],
    exampleQuestions: [
      '上个月的全量线索大定支付转化率是多少？如果剔除退订订单，大定转化率有什么差别？',
      '统计线索大盘的线索量、订单数、订单转化率和转化订单金额。',
    ],
  },
  metrics: [
    {
      name: 'clew_count',
      expression: 'COUNT(DISTINCT "clew_id")',
    },
    {
      name: 'order_count_with_refund',
      expression:
        'COUNT(DISTINCT CASE WHEN "has_ord_pay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)',
    },
    {
      name: 'order_count',
      expression:
        'COUNT(DISTINCT CASE WHEN "has_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)',
    },
    {
      name: 'conversion_rate_with_refund',
      expression:
        'ROUND(COUNT(DISTINCT CASE WHEN "has_ord_pay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END) * 100.0 / NULLIF(SUM("lead_count"), 0), 2)',
    },
    {
      name: 'conversion_rate',
      expression:
        'ROUND(COUNT(DISTINCT CASE WHEN "has_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END) * 100.0 / NULLIF(SUM("lead_count"), 0), 2)',
    },
    {
      name: 'total_amount_with_refund',
      expression:
        'COALESCE(SUM(CASE WHEN "is_ord_pay" = 1 AND "order_date" >= "min_clew_date" THEN "actual_price" END), 0)',
    },
    {
      name: 'total_amount',
      expression:
        'COALESCE(SUM(CASE WHEN "is_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "actual_price" END), 0)',
    },
    {
      name: 'refund_impact_pct',
      expression:
        'ROUND((COUNT(DISTINCT CASE WHEN "has_ord_pay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END) - COUNT(DISTINCT CASE WHEN "has_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)) * 100.0 / NULLIF(SUM("lead_count"), 0), 2)',
    },
  ],
  forbiddenPatterns: [
    'COUNT(*) AS clew_count',
    'COUNT(*) AS lead_count',
    'converted_order_count / total_clew_count',
    'assigned_clew_count',
    'mobile_md5 = phone_no_md5',
    'paid_flag',
    'INNER JOIN "dv_ord_core"',
  ],
  extraInstruction:
    '线索大盘转化指标必须使用商机级归因，并固定使用条件聚合结构：第一段 leads_per_niche，以 dv_clew_core 为线索主视图，先按 niche_id 聚合线索，统计 COUNT(DISTINCT "clew_id") AS "lead_count"，并取每个商机最早线索创建日期。最终查询必须从 leads_per_niche 出发 LEFT JOIN dv_ord_core，以保留无订单线索分母；不要使用 INNER JOIN 作为线索到订单的主关联。订单归因不要做成先 WHERE 过滤再 JOIN，也不要把订单创建时间归因条件只放在 JOIN ON 中；必须在订单数、转化率和金额的 CASE WHEN 条件里同时判断订单状态和订单创建时间，例如 COUNT(DISTINCT CASE WHEN "has_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)，生成 SQL 时按实际别名展开为类似 COUNT(DISTINCT CASE WHEN "o"."is_ord_fdpay" = 1 AND "o"."order_date" >= "l"."min_clew_date" THEN "l"."niche_id" END)。默认订单数、订单转化率和转化订单金额使用 "is_ord_fdpay" = 1 的不含退订真实有效口径；只有当用户明确要求含退订、含退款或大定支付含退订时，才使用 "is_ord_pay" = 1；不要用 paid_flag 替代 "is_ord_pay"。最终汇总时线索量使用 SUM("lead_count")，含退订订单量使用 COUNT(DISTINCT CASE WHEN "has_ord_pay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)，不含退订订单量使用 COUNT(DISTINCT CASE WHEN "has_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)。如果按城市、来源、时间、渠道、线索等级等维度分析，线索侧 CTE 必须 SELECT 并 GROUP BY niche_id + 所有展示/分组维度；不要只按展示维度先聚合后再 join 订单，否则后续 l.niche_id 不存在。订单侧聚合也必须保留同样的 niche_id + 维度键，最终 LEFT JOIN 按这些键连接，最后 SELECT 才按展示维度汇总。用户询问线索四级来源目录、来源渠道转化率或来源维度排名时，必须在 dv_clew_core 的检索字段中选择表示四级来源目录/来源渠道的字段作为 GROUP BY 维度；不要因为智能分配表中存在 channel_id 就改用 dv_assign_total_conversion_core。',
};

const DEFAULT_NICHE_DRIVE_CONVERSION_FORMULA: MetricFormula = {
  id: 'denodo_niche_drive_conversion',
  enabled: true,
  dataSource: 'denodo',
  name: '智能分配试驾转化指标',
  description: '智能分配线索后试驾情况，以及相关转化订单数、转化金额和转化率。',
  scope: {
    primaryModel: 'admin.dv_niche_ord_conversion_core',
    requiredModels: [],
  },
  match: {
    triggerPhrases: [
      '智能分配试驾',
      '智能分配完成试驾',
      '通过智能分配完成试驾',
      '试驾转化率',
      '试驾线索转化',
      '智能分配试驾转化',
      '试驾量',
      '成单数',
    ],
    exampleQuestions: [
      '查一下上个月通过智能分配完成试驾的线索中，有多少最终转化成了订单？试驾转化率是多少？',
      '上月各城市通过智能分配试驾的线索转化效果如何？按城市统计试驾量、成单数和转化率。',
    ],
  },
  metrics: [
    {
      name: 'drive_clew_count',
      expression:
        'COUNT(DISTINCT CASE WHEN "ai_assign_drive_cnt" > 0 THEN "clew_id" END)',
    },
    {
      name: 'order_count',
      expression:
        'COUNT(DISTINCT CASE WHEN "ai_assign_drive_cnt" > 0 AND "is_ord_fdpay" = 1 THEN "biz_order_no" END)',
    },
    {
      name: 'drive_conversion_rate',
      expression:
        'ROUND(COUNT(DISTINCT CASE WHEN "ai_assign_drive_cnt" > 0 AND "is_ord_fdpay" = 1 THEN "biz_order_no" END) * 100.0 / NULLIF(COUNT(DISTINCT CASE WHEN "ai_assign_drive_cnt" > 0 THEN "clew_id" END), 0), 2)',
    },
    {
      name: 'total_amount',
      expression:
        'COALESCE(SUM(CASE WHEN "ai_assign_drive_cnt" > 0 AND "is_ord_fdpay" = 1 THEN "actual_price" END), 0)',
    },
  ],
  forbiddenPatterns: [
    'dv_assign_total_conversion_core',
    'dv_clew_core',
    'dv_ord_core',
    'mobile_md5 = phone_no_md5',
    'ROW_NUMBER() OVER',
    'COUNT(*) AS drive_clew_count',
    'COUNT(*) AS order_count',
  ],
  extraInstruction:
    '智能分配试驾相关转化率必须使用 admin.dv_niche_ord_conversion_core（或检索上下文中同名不带 schema 的 dv_niche_ord_conversion_core）作为权威视图。该视图是在明细视图基础上加入试驾相关信息的 niche 转化辅助分析视图，适合统计智能分配线索后的试驾情况，以及相关转化订单数、转化金额和转化率。试驾样本必须限定 "ai_assign_drive_cnt" > 0。默认转化订单数、转化率和转化金额使用 "is_ord_fdpay" = 1 的不含退订有效订单口径。不要回退到 dv_assign_total_conversion_core，也不要重新拼接 dv_clew_core / dv_ord_core 或使用 mobile_md5 = phone_no_md5 自行归因。如果按城市、门店、时间、策略等维度分析，直接在该视图中按对应维度 GROUP BY，并保持同一试驾样本和有效订单口径。',
};

const DEFAULT_PACKAGE_ORDER_FORMULA: MetricFormula = {
  id: 'denodo_package_order_metrics',
  enabled: true,
  dataSource: 'denodo',
  name: '选装包订单热度和价格增幅',
  description: '选装包订单数排名、平均选装包价格、选装包总收入。',
  scope: {
    primaryModel: 'dv_package_order_core',
    requiredModels: [],
  },
  match: {
    triggerPhrases: [
      '选装包',
      '选配包',
      '配置包',
      '最受欢迎选装包',
      '平均额外车价增幅',
      '选装包订单数量',
    ],
    exampleQuestions: [
      '统计上个月最受欢迎的 3 个选装包（按选择该选装包的订单数量排名），并列出每个选装包带来的平均额外车价增幅。',
    ],
  },
  metrics: [
    {
      name: 'order_count',
      expression: 'COUNT(DISTINCT "biz_order_no")',
    },
    {
      name: 'avg_package_price',
      expression: 'ROUND(AVG("package_price"), 2)',
    },
    {
      name: 'total_package_revenue',
      expression: 'ROUND(SUM("package_price"), 2)',
    },
  ],
  forbiddenPatterns: [
    'dv_ord_core',
    'city_name',
    'option_amount',
    'SUM("order_count")',
    'COUNT("biz_order_no") AS "order_count"',
  ],
  extraInstruction:
    '选装包热度、最受欢迎选装包、选装包销量/订单数排名、平均额外车价增幅必须使用 dv_package_order_core。按 "package_name" 分组，不要按城市、车系或订单主表维度替代。订单数量使用 COUNT(DISTINCT "biz_order_no")，不要使用 SUM("order_count") 或普通 COUNT("biz_order_no")。平均额外车价增幅直接使用 package_price 金额口径；如用户要求收入贡献，可同时给出 SUM("package_price")。时间过滤优先使用该视图的 "order_year_month"。Top N 选装包按 order_count 降序、package_name 升序稳定排序；如果 Top N 结果还要继续参与下游 join/filter，使用 Denodo correlated-count 过滤，不要改查 dv_ord_core。',
};

const DEFAULT_STORE: MetricFormulaStore = {
  version: STORE_VERSION,
  formulas: [
    DEFAULT_ASSIGN_CONVERSION_FORMULA,
    DEFAULT_CLEW_OVERVIEW_CONVERSION_FORMULA,
    DEFAULT_NICHE_DRIVE_CONVERSION_FORMULA,
    DEFAULT_PACKAGE_ORDER_FORMULA,
  ],
};

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const cleanStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(cleanString).filter((item) => item.length > 0)
    : [];

const cleanMetrics = (value: unknown): MetricFormulaMetric[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((metric) => {
      if (!metric || typeof metric !== 'object') return null;
      const item = metric as Record<string, unknown>;
      const name = cleanString(item.name);
      const expression = cleanString(item.expression);
      if (!name || !expression) return null;
      const description = cleanString(item.description);
      return {
        name,
        expression,
        ...(description ? { description } : {}),
      };
    })
    .filter(Boolean) as MetricFormulaMetric[];
};

const normalizeId = (id: string): string =>
  id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

const buildIdFromName = (name: string): string => {
  const normalized = normalizeId(name);
  return normalized || `metric_formula_${Date.now()}`;
};

export class MetricFormulaService implements IMetricFormulaService {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || this.resolveDefaultFilePath();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public async listFormulas(): Promise<MetricFormula[]> {
    return this.readStore().formulas;
  }

  public async listEnabledFormulas(): Promise<MetricFormula[]> {
    const formulas = await this.listFormulas();
    return formulas.filter((formula) => formula.enabled !== false);
  }

  public async createFormula(
    input: Partial<MetricFormula>,
  ): Promise<MetricFormula> {
    const store = this.readStore();
    const formula = this.normalizeFormula(input, { requireId: false });

    if (store.formulas.some((item) => item.id === formula.id)) {
      throw new Error(`Metric formula "${formula.id}" already exists`);
    }

    const timestamp = nowIso();
    const newFormula = {
      ...formula,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.writeStore({
      ...store,
      formulas: [...store.formulas, newFormula],
    });

    return newFormula;
  }

  public async updateFormula(
    id: string,
    input: Partial<MetricFormula>,
  ): Promise<MetricFormula> {
    const formulaId = normalizeId(id);
    if (!formulaId) throw new Error('Metric formula id is required');

    const store = this.readStore();
    const index = store.formulas.findIndex(
      (formula) => formula.id === formulaId,
    );
    if (index === -1) {
      throw new Error(`Metric formula "${formulaId}" not found`);
    }

    const existing = store.formulas[index];
    const normalized = this.normalizeFormula(
      {
        ...existing,
        ...input,
        id: formulaId,
        scope: {
          ...existing.scope,
          ...(input.scope || {}),
        },
        match: {
          ...existing.match,
          ...(input.match || {}),
        },
      },
      { requireId: true },
    );
    const updatedFormula = {
      ...normalized,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };
    const formulas = [...store.formulas];
    formulas[index] = updatedFormula;

    this.writeStore({
      ...store,
      formulas,
    });

    return updatedFormula;
  }

  public async deleteFormula(id: string): Promise<void> {
    const formulaId = normalizeId(id);
    if (!formulaId) throw new Error('Metric formula id is required');

    const store = this.readStore();
    const formulas = store.formulas.filter(
      (formula) => formula.id !== formulaId,
    );
    if (formulas.length === store.formulas.length) {
      throw new Error(`Metric formula "${formulaId}" not found`);
    }

    this.writeStore({
      ...store,
      formulas,
    });
  }

  private resolveDefaultFilePath(): string {
    if (process.env.METRIC_FORMULAS_FILE) {
      return path.resolve(process.env.METRIC_FORMULAS_FILE);
    }

    if (process.env.SQLITE_FILE) {
      return path.resolve(
        path.dirname(process.env.SQLITE_FILE),
        STORE_FILE_NAME,
      );
    }

    return path.resolve(process.cwd(), 'data', STORE_FILE_NAME);
  }

  private readStore(): MetricFormulaStore {
    this.ensureStoreFile();

    const rawContent = fs.readFileSync(this.filePath, 'utf8');
    let parsed: MetricFormulaStore;
    try {
      parsed = JSON.parse(rawContent);
    } catch (error: any) {
      throw new Error(`Failed to parse metric formulas file: ${error.message}`);
    }

    return {
      version: Number(parsed.version) || STORE_VERSION,
      formulas: Array.isArray(parsed.formulas)
        ? parsed.formulas.map((formula) =>
            this.normalizeFormula(formula, { requireId: true }),
          )
        : [],
    };
  }

  private ensureStoreFile() {
    if (fs.existsSync(this.filePath)) return;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.writeStore(DEFAULT_STORE);
  }

  private writeStore(store: MetricFormulaStore) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(
      tempPath,
      `${JSON.stringify(this.normalizeStore(store), null, 2)}\n`,
      'utf8',
    );
    fs.renameSync(tempPath, this.filePath);
  }

  private normalizeStore(store: MetricFormulaStore): MetricFormulaStore {
    return {
      version: Number(store.version) || STORE_VERSION,
      formulas: Array.isArray(store.formulas) ? store.formulas : [],
    };
  }

  private normalizeFormula(
    input: Partial<MetricFormula>,
    options: { requireId: boolean },
  ): MetricFormula {
    const name = cleanString(input.name);
    if (!name) throw new Error('Metric formula name is required');

    const id = normalizeId(cleanString(input.id) || buildIdFromName(name));
    if (options.requireId && !id) {
      throw new Error('Metric formula id is required');
    }

    const primaryModel = cleanString(input.scope?.primaryModel);
    if (!primaryModel) {
      throw new Error('Metric formula primary model is required');
    }

    const metrics = cleanMetrics(input.metrics);
    if (metrics.length === 0) {
      throw new Error('Metric formula must include at least one metric');
    }

    const description = cleanString(input.description);
    const extraInstruction = cleanString(input.extraInstruction);

    return {
      id,
      enabled: input.enabled !== false,
      dataSource: cleanString(input.dataSource) || 'denodo',
      name,
      ...(description ? { description } : {}),
      scope: {
        primaryModel,
        requiredModels: cleanStringArray(input.scope?.requiredModels),
      },
      match: {
        triggerPhrases: cleanStringArray(input.match?.triggerPhrases),
        exampleQuestions: cleanStringArray(input.match?.exampleQuestions),
      },
      metrics,
      forbiddenPatterns: cleanStringArray(input.forbiddenPatterns),
      ...(extraInstruction ? { extraInstruction } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    };
  }
}
