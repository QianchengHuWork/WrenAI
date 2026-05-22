export interface MetricFormulaMetric {
  name: string;
  expression: string;
  description?: string;
}

export interface MetricFormulaScope {
  primaryModel: string;
  requiredModels: string[];
}

export interface MetricFormulaMatch {
  triggerPhrases: string[];
  exampleQuestions: string[];
}

export interface MetricFormula {
  id: string;
  enabled: boolean;
  dataSource: string;
  name: string;
  description?: string;
  scope: MetricFormulaScope;
  match: MetricFormulaMatch;
  metrics: MetricFormulaMetric[];
  forbiddenPatterns: string[];
  extraInstruction?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MetricFormulaStore {
  version: number;
  formulas: MetricFormula[];
}
