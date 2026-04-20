import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export enum SemanticDictionaryBuildJobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export interface SemanticDictionaryBuildJob {
  id: number;
  projectId: number;
  status: SemanticDictionaryBuildJobStatus;
  currentStepKey: string | null;
  currentStepDescription: string | null;
  totalTasks: number;
  totalBatches: number;
  completedBatches: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISemanticDictionaryBuildJobRepository
  extends IBasicRepository<SemanticDictionaryBuildJob> {
  enqueue(projectId: number): Promise<SemanticDictionaryBuildJob>;
  getByProjectId(projectId: number): Promise<SemanticDictionaryBuildJob | null>;
  findRunnableJobs(staleBefore: Date): Promise<SemanticDictionaryBuildJob[]>;
  claimJob(
    projectId: number,
    staleBefore: Date,
  ): Promise<SemanticDictionaryBuildJob | null>;
}

export class SemanticDictionaryBuildJobRepository
  extends BaseRepository<SemanticDictionaryBuildJob>
  implements ISemanticDictionaryBuildJobRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'semantic_dictionary_build_job' });
  }

  public async enqueue(projectId: number) {
    const now = new Date();
    const payload = this.transformToDBData({
      projectId,
      status: SemanticDictionaryBuildJobStatus.PENDING,
      currentStepKey: null,
      currentStepDescription: null,
      totalTasks: 0,
      totalBatches: 0,
      completedBatches: 0,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      updatedAt: now,
    });

    const [result] = await this.knex(this.tableName)
      .insert(payload)
      .onConflict('project_id')
      .merge(payload)
      .returning('*');

    return this.transformFromDBData(result);
  }

  public async getByProjectId(projectId: number) {
    return this.findOneBy({ projectId } as Partial<SemanticDictionaryBuildJob>);
  }

  public async findRunnableJobs(staleBefore: Date) {
    const result = await this.knex(this.tableName)
      .where('status', SemanticDictionaryBuildJobStatus.PENDING)
      .orWhere((builder) => {
        builder
          .where('status', SemanticDictionaryBuildJobStatus.RUNNING)
          .andWhere('updated_at', '<', staleBefore);
      })
      .orderBy('updated_at', 'asc');

    return result.map(this.transformFromDBData);
  }

  public async claimJob(projectId: number, staleBefore: Date) {
    const [result] = await this.knex(this.tableName)
      .where({ project_id: projectId })
      .andWhere((builder) => {
        builder
          .where('status', SemanticDictionaryBuildJobStatus.PENDING)
          .orWhere((inner) => {
            inner
              .where('status', SemanticDictionaryBuildJobStatus.RUNNING)
              .andWhere('updated_at', '<', staleBefore);
          });
      })
      .update({
        status: SemanticDictionaryBuildJobStatus.RUNNING,
        started_at: this.knex.raw('COALESCE(started_at, CURRENT_TIMESTAMP)'),
        finished_at: null,
        error_message: null,
        updated_at: this.knex.fn.now(),
      })
      .returning('*');

    return result ? this.transformFromDBData(result) : null;
  }
}
