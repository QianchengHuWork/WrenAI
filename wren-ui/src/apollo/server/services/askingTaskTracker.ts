import {
  appendTimingTrace,
  countToolCalls,
  createTimingStep,
  getLogger,
  nowMs,
} from '@server/utils';
import {
  AskResult,
  AskResultType,
  AskResultStatus,
  AskInput,
  SQLDialect,
} from '@server/models/adaptor';
import {
  AskingTask,
  IAskingTaskRepository,
  Project,
  IThreadResponseRepository,
  IViewRepository,
} from '@server/repositories';
import { IWrenAIAdaptor } from '../adaptors';
import * as Errors from '@server/utils/error';
import { DataSourceName } from '@server/types';
import { IProjectService } from './projectService';
import { IDeployService } from './deployService';
import { IDenodoSqlGuardService } from './denodoSqlGuardService';

const logger = getLogger('AskingTaskTracker');
logger.level = 'debug';

interface TrackedTask {
  queryId: string;
  taskId?: number;
  lastPolled: number;
  question?: string;
  result?: AskResult;
  isFinalized: boolean;
  threadResponseId?: number;
  rerunFromCancelled?: boolean;
  timingSteps?: AskResult['timingEvents'];
  askPostedAt?: number;
  aiPollStartedAt?: number;
  aiPollRecorded?: boolean;
  timingTraceWritten?: boolean;
}

export type TrackedAskingResult = AskResult & {
  taskId?: number;
  queryId: string;
  question: string;
};

export type CreateAskingTaskInput = AskInput & {
  rerunFromCancelled?: boolean;
  previousTaskId?: number;
  threadResponseId?: number;
};

export interface IAskingTaskTracker {
  createAskingTask(input: CreateAskingTaskInput): Promise<{ queryId: string }>;
  getAskingResult(queryId: string): Promise<TrackedAskingResult | null>;
  getAskingResultById(id: number): Promise<TrackedAskingResult | null>;
  cancelAskingTask(queryId: string): Promise<void>;
  bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
  ): Promise<void>;
}

export class AskingTaskTracker implements IAskingTaskTracker {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private askingTaskRepository: IAskingTaskRepository;
  private trackedTasks: Map<string, TrackedTask> = new Map();
  private trackedTasksById: Map<number, TrackedTask> = new Map();
  private pollingInterval: number;
  private memoryRetentionTime: number;
  private pollingIntervalId: NodeJS.Timeout;
  private runningJobs = new Set<string>();
  private threadResponseRepository: IThreadResponseRepository;
  private viewRepository: IViewRepository;
  private projectService: IProjectService;
  private deployService: IDeployService;
  private denodoSqlGuardService: IDenodoSqlGuardService;

  constructor({
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    viewRepository,
    projectService,
    deployService,
    denodoSqlGuardService,
    pollingInterval = 1000, // 1 second
    memoryRetentionTime = 5 * 60 * 1000, // 5 minutes
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    askingTaskRepository: IAskingTaskRepository;
    threadResponseRepository: IThreadResponseRepository;
    viewRepository: IViewRepository;
    projectService: IProjectService;
    deployService: IDeployService;
    denodoSqlGuardService: IDenodoSqlGuardService;
    pollingInterval?: number;
    memoryRetentionTime?: number;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.askingTaskRepository = askingTaskRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.viewRepository = viewRepository;
    this.projectService = projectService;
    this.deployService = deployService;
    this.denodoSqlGuardService = denodoSqlGuardService;
    this.pollingInterval = pollingInterval;
    this.memoryRetentionTime = memoryRetentionTime;
    this.startPolling();
  }

  public async createAskingTask(
    input: CreateAskingTaskInput,
  ): Promise<{ queryId: string }> {
    try {
      // Call the AI service to create a task
      const askPostStartedAt = nowMs();
      const response = await this.wrenAIAdaptor.ask(input);
      const queryId = response.queryId;
      const askPostedAt = nowMs();

      // validate the input
      if (
        input.rerunFromCancelled &&
        (!input.previousTaskId || !input.threadResponseId)
      ) {
        throw new Error(
          'Previous task id and thread response id are required if rerun from cancelled',
        );
      }

      // Start tracking this task
      const task = {
        queryId,
        lastPolled: Date.now(),
        question: input.query,
        isFinalized: false,
        rerunFromCancelled: input.rerunFromCancelled,
        timingSteps: [
          createTimingStep('ui.ask_post', askPostStartedAt, { queryId }),
        ],
        askPostedAt,
        aiPollStartedAt: askPostedAt,
      } as TrackedTask;
      this.trackedTasks.set(queryId, task);

      // if rerun from cancelled, we update the query id to the previous task
      if (
        input.rerunFromCancelled &&
        input.previousTaskId &&
        input.threadResponseId
      ) {
        // set the thread response id in memory to bind the task to the thread response
        // we don't have to update to database here because the thread response id is already set in database
        task.threadResponseId = input.threadResponseId;

        // update the task id in memory
        this.trackedTasksById.set(input.previousTaskId, task);

        // get the latest result from the AI service
        // we get the latest result first to make it more responsive to client-side
        const result = await this.wrenAIAdaptor.getAskResult(queryId);

        // update the result in memory
        task.result = result;

        // update the query id in database
        await this.askingTaskRepository.updateOne(input.previousTaskId, {
          queryId,
        });
      }

      logger.info(`Created asking task with queryId: ${queryId}`);
      return { queryId };
    } catch (err) {
      logger.error(`Failed to create asking task: ${err}`);
      throw err;
    }
  }

  public async getAskingResult(
    queryId: string,
  ): Promise<TrackedAskingResult | null> {
    // Check if we're tracking this task in memory
    const trackedTask = this.trackedTasks.get(queryId);

    if (trackedTask && trackedTask.result) {
      return {
        ...trackedTask.result,
        queryId,
        question: trackedTask.question,
        taskId: trackedTask.taskId,
      };
    }

    // If not in memory or no result yet, check the database
    return this.getAskingResultFromDB({ queryId });
  }

  public async getAskingResultById(
    id: number,
  ): Promise<TrackedAskingResult | null> {
    const task = this.trackedTasksById.get(id);
    if (task) {
      return this.getAskingResult(task.queryId);
    }

    return this.getAskingResultFromDB({ taskId: id });
  }

  public async cancelAskingTask(queryId: string): Promise<void> {
    await this.wrenAIAdaptor.cancelAsk(queryId);
  }

  public stopPolling(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }
  }

  public async bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
  ): Promise<void> {
    const task = this.trackedTasks.get(queryId);
    if (!task) {
      throw new Error(`Task ${queryId} not found`);
    }

    task.threadResponseId = threadResponseId;
    this.trackedTasksById.set(id, task);
    await this.askingTaskRepository.updateOne(id, {
      threadId,
      threadResponseId,
    });

    // check if the task is finalized and has a sql
    if (task.isFinalized) {
      await this.updateThreadResponseWhenTaskFinalized(task);
    }
  }

  private startPolling(): void {
    this.pollingIntervalId = setInterval(() => {
      this.pollTasks();
    }, this.pollingInterval);
  }

  private async pollTasks(): Promise<void> {
    const now = Date.now();
    const tasksToRemove: string[] = [];

    // Create an array of job functions
    const jobs = Array.from(this.trackedTasks.entries()).map(
      ([queryId, task]) =>
        async () => {
          try {
            // Skip if the job is already running
            if (this.runningJobs.has(queryId)) {
              return;
            }

            // Skip finalized tasks that have been in memory too long
            if (
              task.isFinalized &&
              now - task.lastPolled > this.memoryRetentionTime
            ) {
              tasksToRemove.push(queryId);
              return;
            }

            // Skip finalized tasks
            if (task.isFinalized) {
              return;
            }

            // Mark the job as running
            this.runningJobs.add(queryId);

            // Poll for updates
            logger.info(`Polling for updates for task ${queryId}`);
            let result = await this.wrenAIAdaptor.getAskResult(queryId);
            task.lastPolled = now;

            // if result is not changed, we don't need to update the database
            if (!this.isResultChanged(task.result, result)) {
              this.runningJobs.delete(queryId);
              return;
            }

            // update task in memory if any change
            task.result = result;

            // if result is still understanding, we don't need to update the database
            if (result.status === AskResultStatus.UNDERSTANDING) {
              this.runningJobs.delete(queryId);
              return;
            }

            // if it's identified as GENERAL or MISLEADING_QUER
            // we don't need to update the database and finalize the task
            if (
              result.type === AskResultType.GENERAL ||
              result.type === AskResultType.MISLEADING_QUERY
            ) {
              task.isFinalized = true;
              // if it's rerun from cancelled, we need to update the task result to failed in db
              if (task.rerunFromCancelled) {
                const errorCode =
                  result.type === AskResultType.GENERAL
                    ? Errors.GeneralErrorCodes.IDENTIED_AS_GENERAL
                    : Errors.GeneralErrorCodes.IDENTIED_AS_MISLEADING_QUERY;
                const error = {
                  code: errorCode,
                  message: Errors.errorMessages[errorCode],
                  shortMessage: Errors.shortMessages[errorCode],
                };
                await this.updateTaskInDatabase(
                  { queryId },
                  {
                    ...task,
                    // update the status to failed
                    // and the error message should be "IDENTIED_AS_GENERAL" or "IDENTIED_AS_MISLEADING_QUERY"
                    result: {
                      ...task.result,
                      status: AskResultStatus.FAILED,
                      error,
                    },
                  },
                );
              }
              this.runningJobs.delete(queryId);
              return;
            }

            const project = await this.projectService.getCurrentProject();

            if (this.isTaskFinalized(result.status) && !task.aiPollRecorded) {
              task.timingSteps = [
                ...(task.timingSteps || []),
                createTimingStep(
                  'ui.poll_until_ai_finished',
                  task.aiPollStartedAt || task.askPostedAt || now,
                  { aiStatus: result.status },
                ),
              ];
              task.aiPollRecorded = true;
            }

            if (this.shouldGuardDenodoSql(project, result)) {
              const correctingResult = {
                ...result,
                status: AskResultStatus.CORRECTING,
              } as AskResult;
              task.result = correctingResult;
              await this.updateTaskInDatabase({ queryId }, task);

              const deployment = await this.deployService.getLastDeployment(
                project.id,
              );
              const guardedResult =
                await this.denodoSqlGuardService.guardAskResult({
                  askResult: result,
                  manifest: deployment.manifest,
                  project,
                });
              task.result = guardedResult;
              result = guardedResult;
            }

            // update the database
            // note: type could be null if it's still being understood or it's stopped
            // we already filtered out the understanding status above
            // so we update to database if it's stopped as well here.
            logger.info(`Updating task ${queryId} in database`);
            await this.updateTaskInDatabase({ queryId }, task);

            // Check if task is now finalized
            if (this.isTaskFinalized(result.status)) {
              task.isFinalized = true;
              this.writeAskTimingTrace(task, result);
              // update thread response if threadResponseId is provided
              if (task.threadResponseId) {
                await this.updateThreadResponseWhenTaskFinalized(task);
              }

              logger.info(
                `Task ${queryId} is finalized with status: ${result.status}`,
              );
            }

            // Mark the job as finished
            this.runningJobs.delete(queryId);
          } catch (err) {
            this.runningJobs.delete(queryId);
            logger.error(err.stack);
            throw err;
          }
        },
    );

    // Run all jobs in parallel
    Promise.allSettled(jobs.map((job) => job())).then((results) => {
      // Log any rejected promises
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error(`Job ${index} failed: ${result.reason}`);
        }
      });

      // Clean up tasks that have been in memory too long
      if (tasksToRemove.length > 0) {
        logger.info(
          `Cleaning up tasks that have been in memory too long. Tasks: ${tasksToRemove.join(
            ', ',
          )}`,
        );
      }
      for (const queryId of tasksToRemove) {
        this.trackedTasks.delete(queryId);
      }
    });
  }

  private async updateThreadResponseWhenTaskFinalized(
    task: TrackedTask,
  ): Promise<void> {
    const response = task?.result?.response?.[0];
    if (!response) {
      return;
    }
    // if the generated response of asking task is not null, update the thread response
    if (response.viewId) {
      // get sql from the view
      const view = await this.viewRepository.findOneBy({
        id: response.viewId,
      });
      await this.threadResponseRepository.updateOne(task.threadResponseId, {
        sql: view.statement,
        sqlDialect: SQLDialect.WREN,
        viewId: response.viewId,
      });
    } else {
      await this.threadResponseRepository.updateOne(task.threadResponseId, {
        sql: response?.sql,
        sqlDialect: response?.sqlDialect || SQLDialect.WREN,
      });
    }
  }

  private writeAskTimingTrace(task: TrackedTask, result: AskResult) {
    if (task.timingTraceWritten) return;

    const toolCalls = result.toolCalls || [];
    const { validateCount, correctionCount } = countToolCalls(toolCalls);
    const steps = [
      ...(task.timingSteps || []),
      ...(result.timingEvents || []),
    ];

    try {
      appendTimingTrace({
        event: 'ask_finished',
        askQueryId: task.queryId,
        traceId: result.traceId,
        question: task.question,
        status: result.status,
        selectedModels: result.selectedModels,
        validateCount,
        correctionCount,
        toolCalls,
        steps,
      });
      task.timingTraceWritten = true;
    } catch (error: any) {
      logger.warn(`Failed to write ask timing trace: ${error.message}`);
    }
  }

  private async getAskingResultFromDB({
    queryId,
    taskId,
  }: {
    queryId?: string;
    taskId?: number;
  }): Promise<TrackedAskingResult | null> {
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findByQueryId(queryId);
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({ id: taskId });
    }

    if (!taskRecord) {
      return null;
    }

    return {
      ...(taskRecord?.detail as AskResult),
      queryId: queryId || taskRecord?.queryId,
      question: taskRecord?.question,
      taskId: taskRecord?.id,
    };
  }

  private async updateTaskInDatabase(
    filter: { queryId?: string; taskId?: number },
    trackedTask: TrackedTask,
  ): Promise<void> {
    const { queryId, taskId } = filter;
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findByQueryId(queryId);
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({ id: taskId });
    }

    if (!taskRecord) {
      // if record not found, create one
      const task = await this.askingTaskRepository.createOne({
        queryId,
        question: trackedTask.question,
        detail: trackedTask.result,
      });
      // update the task id in memory
      let existingTask: TrackedTask;
      if (queryId) {
        existingTask = this.trackedTasks.get(queryId);
      } else if (taskId) {
        existingTask = this.trackedTasksById.get(taskId);
      }
      if (existingTask) {
        existingTask.taskId = task.id;
      }
      return;
    }

    // update the task
    await this.askingTaskRepository.updateOne(taskRecord.id, {
      detail: trackedTask.result,
    });
  }

  private isTaskFinalized(status: AskResultStatus): boolean {
    return [
      AskResultStatus.FINISHED,
      AskResultStatus.FAILED,
      AskResultStatus.STOPPED,
    ].includes(status);
  }

  private isResultChanged(
    previousResult: AskResult,
    newResult: AskResult,
  ): boolean {
    // check status change
    if (previousResult?.status !== newResult.status) {
      return true;
    }

    return false;
  }

  private shouldGuardDenodoSql(project: Project, result: AskResult): boolean {
    return (
      project.type === DataSourceName.DENODO_MCP &&
      result.status === AskResultStatus.FINISHED &&
      result.type === AskResultType.TEXT_TO_SQL &&
      Array.isArray(result.response) &&
      result.response.some((candidate) => candidate?.sql)
    );
  }
}
