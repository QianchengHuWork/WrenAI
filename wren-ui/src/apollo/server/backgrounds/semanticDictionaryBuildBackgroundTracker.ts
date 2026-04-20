import { IWrenAIAdaptor } from '@server/adaptors';
import { Manifest } from '@server/mdl/type';
import {
  IProjectRepository,
  ISemanticDictionaryBuildJobRepository,
  Project,
  SemanticDictionaryBuildJobStatus,
} from '@server/repositories';
import { DataSourceName } from '@server/types';
import { getLogger } from '@server/utils';
import {
  buildFallbackDenodoSemanticDictionaryEntries,
  buildDenodoSemanticDictionary,
  buildDenodoSemanticDictionaryBatchContext,
  buildDenodoSemanticDictionaryBatches,
  buildDenodoSemanticDictionaryTasks,
  dedupeDenodoSemanticDictionaryEntries,
  normalizeDenodoSemanticDictionaryEntries,
  readDenodoManifest,
  readDenodoRawSchema,
  writeDenodoSemanticArtifacts,
  writeDenodoSemanticDictionaryArtifact,
  isDenodoSemanticDictionaryEnabled,
} from '@server/utils/denodoMcp';
import { WrenAILanguage } from '@server/models/adaptor';

const logger = getLogger('SemanticDictionaryBackgroundTracker');
logger.level = 'debug';

const POLL_INTERVAL = 2000;
const HEARTBEAT_INTERVAL = 5000;
const RUNNING_STALE_MS = 5 * 60 * 1000;
const GLOBAL_TRACKER_INTERVAL_KEY = Symbol.for(
  'wren.semanticDictionaryBuildBackgroundTracker.interval',
);

export class SemanticDictionaryBuildBackgroundTracker {
  private readonly projectRepository: IProjectRepository;
  private readonly semanticDictionaryBuildJobRepository: ISemanticDictionaryBuildJobRepository;
  private readonly wrenAIAdaptor: IWrenAIAdaptor;
  private readonly runningProjects = new Set<number>();

  constructor({
    projectRepository,
    semanticDictionaryBuildJobRepository,
    wrenAIAdaptor,
  }: {
    projectRepository: IProjectRepository;
    semanticDictionaryBuildJobRepository: ISemanticDictionaryBuildJobRepository;
    wrenAIAdaptor: IWrenAIAdaptor;
  }) {
    this.projectRepository = projectRepository;
    this.semanticDictionaryBuildJobRepository =
      semanticDictionaryBuildJobRepository;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.start();
  }

  public async enqueue(projectId: number) {
    if (!isDenodoSemanticDictionaryEnabled()) {
      logger.info(
        `Semantic dictionary build is disabled, skip enqueue for project ${projectId}`,
      );
      return null;
    }
    return this.semanticDictionaryBuildJobRepository.enqueue(projectId);
  }

  private start() {
    if (!isDenodoSemanticDictionaryEnabled()) {
      logger.info('Semantic dictionary background tracker is disabled');
      return;
    }

    const globalState = globalThis as typeof globalThis & {
      [GLOBAL_TRACKER_INTERVAL_KEY]?: NodeJS.Timeout;
    };

    if (globalState[GLOBAL_TRACKER_INTERVAL_KEY]) {
      logger.info(
        'Semantic dictionary background tracker already started in this process',
      );
      return;
    }

    logger.info('Semantic dictionary background tracker started');
    globalState[GLOBAL_TRACKER_INTERVAL_KEY] = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL);
  }

  private async tick() {
    try {
      const runnableJobs =
        await this.semanticDictionaryBuildJobRepository.findRunnableJobs(
          new Date(Date.now() - RUNNING_STALE_MS),
        );

      for (const job of runnableJobs) {
        if (this.runningProjects.has(job.projectId)) {
          continue;
        }

        this.runningProjects.add(job.projectId);
        void this.runJob(job.projectId).finally(() => {
          this.runningProjects.delete(job.projectId);
        });
      }
    } catch (error: any) {
      logger.error(`Failed to poll semantic dictionary jobs: ${error.message}`);
    }
  }

  private async runJob(projectId: number) {
    const claimed = await this.semanticDictionaryBuildJobRepository.claimJob(
      projectId,
      new Date(Date.now() - RUNNING_STALE_MS),
    );
    if (!claimed) {
      return;
    }

    try {
      const project = await this.projectRepository.findOneBy({ id: projectId });
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }
      if (project.type !== DataSourceName.DENODO_MCP) {
        throw new Error(`Project ${projectId} is not a Denodo MCP project`);
      }

      const rawSchema = await readDenodoRawSchema(projectId);
      const manifest = await readDenodoManifest(projectId);
      await this.updateProgress(projectId, {
        currentStepKey: 'DICTIONARY_SELECTING_CANDIDATES',
        currentStepDescription: '正在筛选适合生成业务词典的字段',
        totalTasks: 0,
        totalBatches: 0,
        completedBatches: 0,
      });

      const tasks = buildDenodoSemanticDictionaryTasks({
        manifest,
        rawSchema,
      });
      const batches = buildDenodoSemanticDictionaryBatches(tasks);

      await this.updateProgress(projectId, {
        currentStepKey: 'DICTIONARY_BUILDING_TEMPLATE',
        currentStepDescription: `正在生成词典任务模板，共 ${tasks.length} 个任务`,
        totalTasks: tasks.length,
        totalBatches: batches.length,
        completedBatches: 0,
      });

      await writeDenodoSemanticDictionaryArtifact({
        projectId,
        semanticDictionary: buildDenodoSemanticDictionary([]),
      });

      if (!tasks.length) {
        await this.updateProgress(projectId, {
          currentStepKey: 'DICTIONARY_WRITING',
          currentStepDescription: '没有命中候选列，正在写入空词典文件',
          totalTasks: 0,
          totalBatches: 0,
          completedBatches: 0,
        });
        await writeDenodoSemanticArtifacts({
          projectId,
          rawSchema,
          manifest,
          semanticDictionary: buildDenodoSemanticDictionary([]),
        });
        await this.semanticDictionaryBuildJobRepository.updateOne(claimed.id, {
          status: SemanticDictionaryBuildJobStatus.SUCCESS,
          currentStepKey: 'DICTIONARY_WRITING',
          currentStepDescription: 'Semantic Dictionary 已生成完成',
          finishedAt: new Date(),
          updatedAt: new Date(),
        });
        return;
      }

      const collectedEntries: ReturnType<
        typeof normalizeDenodoSemanticDictionaryEntries
      > = [];
      const batchErrors: string[] = [];

      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        await this.updateProgress(projectId, {
          currentStepKey: 'DICTIONARY_GENERATING_BATCHES',
          currentStepDescription: '正在生成词典内容',
          totalTasks: tasks.length,
          totalBatches: batches.length,
          completedBatches: index,
        });

        const { manifestSummary, rawSchemaSummary } =
          buildDenodoSemanticDictionaryBatchContext({
            tasks: batch,
            manifest,
            rawSchema,
          });

        let heartbeat: NodeJS.Timeout | null = null;
        try {
          heartbeat = setInterval(() => {
            void this.updateProgress(projectId, {
              currentStepKey: 'DICTIONARY_GENERATING_BATCHES',
              currentStepDescription: '正在生成词典内容',
              totalTasks: tasks.length,
              totalBatches: batches.length,
              completedBatches: index,
            });
          }, HEARTBEAT_INTERVAL);

          const batchResult =
            await this.wrenAIAdaptor.generateSemanticDictionary({
              projectId: projectId.toString(),
              tasks: batch,
              manifestSummary,
              rawSchemaSummary,
              configurations: {
                language: WrenAILanguage[project.language] || WrenAILanguage.EN,
              },
            });

          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }

          const normalizedEntries = normalizeDenodoSemanticDictionaryEntries({
            tasks: batch,
            result: batchResult,
          });
          const fallbackEntries = buildFallbackDenodoSemanticDictionaryEntries({
            tasks: batch,
            existingEntries: normalizedEntries,
          });
          collectedEntries.push(...normalizedEntries, ...fallbackEntries);

          await writeDenodoSemanticDictionaryArtifact({
            projectId,
            semanticDictionary: buildDenodoSemanticDictionary(
              dedupeDenodoSemanticDictionaryEntries(collectedEntries),
            ),
          });

          await this.updateProgress(projectId, {
            currentStepKey: 'DICTIONARY_GENERATING_BATCHES',
            currentStepDescription: `已写入当前批次结果，累计 ${dedupeDenodoSemanticDictionaryEntries(collectedEntries).length} 条 entries`,
            totalTasks: tasks.length,
            totalBatches: batches.length,
            completedBatches: index + 1,
          });
        } catch (error: any) {
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          const message = `batch ${index + 1}/${batches.length}: ${error.message}`;
          batchErrors.push(message);
          logger.warn(
            `Semantic dictionary batch failed for project ${projectId}: ${message}`,
          );
          if (collectedEntries.length) {
            await writeDenodoSemanticDictionaryArtifact({
              projectId,
              semanticDictionary: buildDenodoSemanticDictionary(
                dedupeDenodoSemanticDictionaryEntries(collectedEntries),
              ),
            });
          }
          continue;
        }
      }

      if (!collectedEntries.length && batchErrors.length) {
        throw new Error(
          `All semantic dictionary batches failed. ${batchErrors.join(' | ')}`,
        );
      }

      await this.updateProgress(projectId, {
        currentStepKey: 'DICTIONARY_NORMALIZING',
        currentStepDescription:
          batchErrors.length > 0
            ? `正在归一化词典结果，当前已生成 ${collectedEntries.length} 条 entries，跳过 ${batchErrors.length} 个失败批次`
            : `正在归一化词典结果，当前已生成 ${collectedEntries.length} 条 entries`,
        totalTasks: tasks.length,
        totalBatches: batches.length,
        completedBatches: batches.length,
      });

      const semanticDictionary = buildDenodoSemanticDictionary(
        dedupeDenodoSemanticDictionaryEntries(collectedEntries),
      );

      if (!semanticDictionary.entries.length) {
        throw new Error(
          'Semantic Dictionary generated zero entries after normalization and fallback',
        );
      }

      await this.updateProgress(projectId, {
        currentStepKey: 'DICTIONARY_VALIDATING',
        currentStepDescription: `正在校验词典，待写入 ${semanticDictionary.entries.length} 条 entries`,
        totalTasks: tasks.length,
        totalBatches: batches.length,
        completedBatches: batches.length,
      });

      await this.updateProgress(projectId, {
        currentStepKey: 'DICTIONARY_WRITING',
        currentStepDescription: '正在写入 semantic-dictionary.json',
        totalTasks: tasks.length,
        totalBatches: batches.length,
        completedBatches: batches.length,
      });

      await writeDenodoSemanticArtifacts({
        projectId,
        rawSchema,
        manifest,
        semanticDictionary,
      });

      await this.semanticDictionaryBuildJobRepository.updateOne(claimed.id, {
        status: SemanticDictionaryBuildJobStatus.SUCCESS,
        currentStepKey: 'DICTIONARY_WRITING',
        currentStepDescription:
          batchErrors.length > 0
            ? `Semantic Dictionary 已生成完成，跳过 ${batchErrors.length} 个失败批次`
            : 'Semantic Dictionary 已生成完成',
        finishedAt: new Date(),
        completedBatches: batches.length,
        totalBatches: batches.length,
        totalTasks: tasks.length,
        updatedAt: new Date(),
        errorMessage:
          batchErrors.length > 0 ? batchErrors.join(' | ') : null,
      });
    } catch (error: any) {
      logger.error(
        `Failed to build semantic dictionary for project ${projectId}: ${error.message}`,
      );
      const job =
        await this.semanticDictionaryBuildJobRepository.getByProjectId(projectId);
      if (job) {
        await this.semanticDictionaryBuildJobRepository.updateOne(job.id, {
          status: SemanticDictionaryBuildJobStatus.FAILED,
          currentStepDescription: 'Semantic Dictionary 后台生成失败',
          errorMessage: error.message,
          finishedAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
  }

  private async updateProgress(
    projectId: number,
    data: {
      currentStepKey: string;
      currentStepDescription: string;
      totalTasks: number;
      totalBatches: number;
      completedBatches: number;
    },
  ) {
    const job = await this.semanticDictionaryBuildJobRepository.getByProjectId(
      projectId,
    );
    if (!job) return;

    await this.semanticDictionaryBuildJobRepository.updateOne(job.id, {
      status: SemanticDictionaryBuildJobStatus.RUNNING,
      currentStepKey: data.currentStepKey,
      currentStepDescription: data.currentStepDescription,
      totalTasks: data.totalTasks,
      totalBatches: data.totalBatches,
      completedBatches: data.completedBatches,
      updatedAt: new Date(),
    });
  }
}
