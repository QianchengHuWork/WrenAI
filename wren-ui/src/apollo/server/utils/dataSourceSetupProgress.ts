import { DataSourceName } from '@server/types';
import {
  SemanticDictionaryBuildJob,
  SemanticDictionaryBuildJobStatus,
} from '@server/repositories';
import { isDenodoSemanticDictionaryEnabled } from '@server/utils/denodoMcp';

export type DataSourceSetupStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type DataSourceSetupStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

export interface DataSourceSetupStep {
  key: string;
  title: string;
  status: DataSourceSetupStepStatus;
  description?: string | null;
}

export interface DataSourceSetupProgressState {
  status: DataSourceSetupStatus;
  dataSourceType?: string | null;
  currentStepKey?: string | null;
  error?: string | null;
  steps: DataSourceSetupStep[];
  updatedAt: string;
}

const buildDefaultState = (): DataSourceSetupProgressState => ({
  status: 'IDLE',
  dataSourceType: null,
  currentStepKey: null,
  error: null,
  steps: [],
  updatedAt: new Date().toISOString(),
});

const buildSteps = (dataSourceType?: string | null): DataSourceSetupStep[] => {
  if (dataSourceType === DataSourceName.DENODO_MCP) {
    const steps: DataSourceSetupStep[] = [
      { key: 'RESETTING_PROJECT', title: '清理旧项目', status: 'PENDING' },
      { key: 'CREATING_PROJECT', title: '创建项目', status: 'PENDING' },
      { key: 'FETCHING_SCHEMA', title: '拉取 Denodo Schema', status: 'PENDING' },
      { key: 'BUILDING_MODELS', title: '生成模型与字段', status: 'PENDING' },
      { key: 'BUILDING_MANIFEST', title: '生成语义层 Manifest', status: 'PENDING' },
      { key: 'WRITING_ARTIFACTS', title: '写入基础语义文件', status: 'PENDING' },
      { key: 'DEPLOYING', title: '部署核心语义层', status: 'PENDING' },
      { key: 'FINALIZING', title: '完成项目初始化', status: 'PENDING' },
    ];
    if (isDenodoSemanticDictionaryEnabled()) {
      steps.push(...buildSemanticDictionarySteps());
    }
    return steps;
  }

  return [
    { key: 'RESETTING_PROJECT', title: '清理旧项目', status: 'PENDING' },
    { key: 'CREATING_PROJECT', title: '创建项目', status: 'PENDING' },
    { key: 'CONNECTING', title: '连接数据源', status: 'PENDING' },
    { key: 'FINALIZING', title: '完成初始化', status: 'PENDING' },
  ];
};

const buildSemanticDictionarySteps = (): DataSourceSetupStep[] => [
  {
    key: 'DICTIONARY_SELECTING_CANDIDATES',
    title: '筛选词典候选列',
    status: 'PENDING',
  },
  {
    key: 'DICTIONARY_BUILDING_TEMPLATE',
    title: '生成词典任务模板',
    status: 'PENDING',
  },
  {
    key: 'DICTIONARY_GENERATING_BATCHES',
    title: '批次生成词典内容',
    status: 'PENDING',
  },
  {
    key: 'DICTIONARY_NORMALIZING',
    title: '归一化词典结果',
    status: 'PENDING',
  },
  {
    key: 'DICTIONARY_VALIDATING',
    title: '校验词典',
    status: 'PENDING',
  },
  {
    key: 'DICTIONARY_WRITING',
    title: '写入 semantic-dictionary.json',
    status: 'PENDING',
  },
];

let progressState: DataSourceSetupProgressState = buildDefaultState();

const touch = () => {
  progressState.updatedAt = new Date().toISOString();
};

export const startDataSourceSetupProgress = (dataSourceType?: string | null) => {
  progressState = {
    status: 'RUNNING',
    dataSourceType: dataSourceType || null,
    currentStepKey: null,
    error: null,
    steps: buildSteps(dataSourceType),
    updatedAt: new Date().toISOString(),
  };
};

export const updateDataSourceSetupProgress = (
  stepKey: string,
  description?: string | null,
) => {
  if (progressState.status === 'IDLE') {
    return;
  }

  progressState.status = 'RUNNING';
  progressState.currentStepKey = stepKey;
  progressState.error = null;
  progressState.steps = progressState.steps.map((step) => {
    if (step.key === stepKey) {
      return {
        ...step,
        status: 'RUNNING',
        description: description ?? step.description ?? null,
      };
    }

    if (step.status === 'RUNNING') {
      return {
        ...step,
        status: 'COMPLETED',
      };
    }

    return step;
  });
  touch();
};

export const completeDataSourceSetupProgress = (description?: string | null) => {
  progressState.status = 'COMPLETED';
  progressState.error = null;
  progressState.steps = progressState.steps.map((step) =>
    step.status === 'PENDING'
      ? step
      : {
          ...step,
          status: 'COMPLETED',
          description:
            step.key === progressState.currentStepKey
              ? description ?? step.description ?? null
              : step.description ?? null,
        },
  );
  touch();
};

export const failDataSourceSetupProgress = (
  error: string,
  description?: string | null,
) => {
  progressState.status = 'FAILED';
  progressState.error = error;
  progressState.steps = progressState.steps.map((step) =>
    step.key === progressState.currentStepKey
      ? {
          ...step,
          status: 'FAILED',
          description: description ?? step.description ?? null,
        }
      : step,
  );
  touch();
};

export const getDataSourceSetupProgress =
  (): DataSourceSetupProgressState => progressState;

export const buildDataSourceSetupProgressFromSemanticDictionaryJob = (
  job: SemanticDictionaryBuildJob | null,
): DataSourceSetupProgressState | null => {
  if (!isDenodoSemanticDictionaryEnabled()) {
    return null;
  }
  if (!job) {
    return null;
  }
  if (job.status === SemanticDictionaryBuildJobStatus.SUCCESS) {
    return null;
  }

  const steps = buildSemanticDictionarySteps().map((step) => {
    if (!job.currentStepKey) {
      return step;
    }

    const orderedKeys = buildSemanticDictionarySteps().map((item) => item.key);
    const currentIndex = orderedKeys.indexOf(job.currentStepKey);
    const stepIndex = orderedKeys.indexOf(step.key);

    if (job.status === SemanticDictionaryBuildJobStatus.FAILED) {
      if (step.key === job.currentStepKey) {
        return {
          ...step,
          status: 'FAILED' as const,
          description: job.currentStepDescription,
        };
      }
      if (stepIndex < currentIndex) {
        return { ...step, status: 'COMPLETED' as const };
      }
      return step;
    }

    if (step.key === job.currentStepKey) {
      return {
        ...step,
        status: 'RUNNING' as const,
        description:
          step.key === 'DICTIONARY_GENERATING_BATCHES' && job.totalBatches
            ? `${job.currentStepDescription}（已完成 ${job.completedBatches}/${job.totalBatches}）`
            : job.currentStepDescription,
      };
    }
    if (stepIndex < currentIndex) {
      return { ...step, status: 'COMPLETED' as const };
    }
    return step;
  });

  return {
    status:
      job.status === SemanticDictionaryBuildJobStatus.FAILED
        ? 'FAILED'
        : 'RUNNING',
    dataSourceType: DataSourceName.DENODO_MCP,
    currentStepKey: job.currentStepKey,
    error: job.errorMessage,
    steps,
    updatedAt: new Date(job.updatedAt).toISOString(),
  };
};

export const resetDataSourceSetupProgress = () => {
  progressState = buildDefaultState();
};
