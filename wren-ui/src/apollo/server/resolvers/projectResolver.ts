import {
  AnalysisRelationInfo,
  DataSource,
  DataSourceName,
  DataSourceProperties,
  IContext,
  RelationData,
  RelationType,
  SampleDatasetData,
} from '../types';
import {
  trim,
  getLogger,
  replaceInvalidReferenceName,
  transformInvalidColumnName,
  handleNestedColumns,
} from '@server/utils';
import {
  DUCKDB_CONNECTION_INFO,
  Model,
  ModelColumn,
  Project,
  Relation,
} from '../repositories';
import {
  SampleDatasetName,
  SampleDatasetRelationship,
  buildInitSql,
  getRelations,
  sampleDatasets,
} from '@server/data';
import { snakeCase } from 'lodash';
import { CompactTable, ProjectData } from '../services';
import { DuckDBPrepareOptions } from '@server/adaptors/wrenEngineAdaptor';
import DataSourceSchemaDetector, {
  SchemaChangeType,
} from '@server/managers/dataSourceSchemaDetector';
import { encryptConnectionInfo } from '../dataSource';
import { TelemetryEvent } from '../telemetry/telemetry';
import {
  DENODO_ASSOCIATION_SOURCE,
  filterDenodoRawSchemaViews,
  isDenodoSemanticDictionaryEnabled,
  toDenodoManifestRelationships,
  toDenodoCompactTables,
  writeDenodoSemanticArtifacts,
} from '@server/utils/denodoMcp';
import { DEFAULT_PROJECT_LANGUAGE } from '@server/models/adaptor';
import {
  buildDataSourceSetupProgressFromSemanticDictionaryJob,
  completeDataSourceSetupProgress,
  failDataSourceSetupProgress,
  getDataSourceSetupProgress,
  startDataSourceSetupProgress,
  startDataSourceSetupProgressWithMode,
  updateDataSourceSetupProgress,
} from '@server/utils/dataSourceSetupProgress';
import { toIbisConnectionInfo } from '@server/dataSource';
import { DENODO_MCP_CONNECTION_INFO } from '@server/repositories';
import { Manifest } from '@server/mdl/type';

const logger = getLogger('DataSourceResolver');
logger.level = 'debug';

export enum OnboardingStatusEnum {
  NOT_STARTED = 'NOT_STARTED',
  DATASOURCE_SAVED = 'DATASOURCE_SAVED',
  ONBOARDING_FINISHED = 'ONBOARDING_FINISHED',
  WITH_SAMPLE_DATASET = 'WITH_SAMPLE_DATASET',
}

const DEFAULT_DENODO_SQL_INSTRUCTION = `
For Denodo SQL generation:
1. Always wrap table names, column names, and alias-qualified columns in double quotes.
2. Prefer semantic fields like *_year, *_month, *_date over casting raw date strings.
3. Do not cast fields already modeled as date/timestamp to TIMESTAMP again.
4. Prefer = or IN for status/enum filters; avoid lower(...) like ... unless pattern matching is required.
5. For numeric text conversions, prefer CAST(... AS DECIMAL).
6. Do not generate LIMIT, FETCH, or TOP.
7. Only use views and columns that exist in the manifest.
`.trim();

const normalizeDenodoSelectedViews = (views?: string[] | null): string[] =>
  Array.from(
    new Set(
      (views || [])
        .map((view) => view?.trim())
        .filter((view): view is string => Boolean(view)),
    ),
  );

export class ProjectResolver {
  constructor() {
    this.getSettings = this.getSettings.bind(this);
    this.updateCurrentProject = this.updateCurrentProject.bind(this);
    this.resetCurrentProject = this.resetCurrentProject.bind(this);
    this.saveDataSource = this.saveDataSource.bind(this);
    this.updateDataSource = this.updateDataSource.bind(this);
    this.refreshDenodoSemanticAssets =
      this.refreshDenodoSemanticAssets.bind(this);
    this.getDataSourceSetupProgress =
      this.getDataSourceSetupProgress.bind(this);
    this.listDataSourceTables = this.listDataSourceTables.bind(this);
    this.saveTables = this.saveTables.bind(this);
    this.autoGenerateRelation = this.autoGenerateRelation.bind(this);
    this.saveRelations = this.saveRelations.bind(this);
    this.getOnboardingStatus = this.getOnboardingStatus.bind(this);
    this.startSampleDataset = this.startSampleDataset.bind(this);
    this.triggerDataSourceDetection =
      this.triggerDataSourceDetection.bind(this);
    this.getSchemaChange = this.getSchemaChange.bind(this);
    this.getProjectRecommendationQuestions =
      this.getProjectRecommendationQuestions.bind(this);
  }

  public async getSettings(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const generalConnectionInfo =
      ctx.projectService.getGeneralConnectionInfo(project);
    const dataSourceType = project.type;

    return {
      productVersion: ctx.config.wrenProductVersion || '',
      dataSource: {
        type: dataSourceType,
        properties: {
          displayName: project.displayName,
          ...generalConnectionInfo,
        } as DataSourceProperties,
        sampleDataset: project.sampleDataset,
      },
      language: project.language || DEFAULT_PROJECT_LANGUAGE,
    };
  }

  public async getProjectRecommendationQuestions(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    return ctx.projectService.getProjectRecommendationQuestions();
  }

  public async updateCurrentProject(
    _root: any,
    arg: { data: { language: string } },
    ctx: IContext,
  ) {
    const { language } = arg.data;
    const project = await ctx.projectService.getCurrentProject();
    await ctx.projectRepository.updateOne(project.id, {
      language,
    });

    // only generating for user's data source
    if (project.sampleDataset === null) {
      await ctx.projectService.generateProjectRecommendationQuestions();
    }
    return true;
  }

  public async resetCurrentProject(_root: any, _arg: any, ctx: IContext) {
    let project;
    try {
      project = await ctx.projectService.getCurrentProject();
    } catch {
      // no project found
      return true;
    }
    const eventName = TelemetryEvent.SETTING_RESET_PROJECT;
    try {
      const id = project.id;
      await ctx.schemaChangeRepository.deleteAllBy({ projectId: id });
      await ctx.deployService.deleteAllByProjectId(id);
      await ctx.askingService.deleteAllByProjectId(id);
      await ctx.modelService.deleteAllViewsByProjectId(id);
      await ctx.modelService.deleteAllModelsByProjectId(id);
      await ctx.projectService.deleteProject(id);
      await ctx.wrenAIAdaptor.delete(id);

      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        projectId: id,
        dataSourceType: project.type,
      });
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }

    return true;
  }

  public async startSampleDataset(
    _root: any,
    _arg: { data: SampleDatasetData },
    ctx: IContext,
  ) {
    const { name } = _arg.data;
    const dataset = sampleDatasets[snakeCase(name)];
    if (!dataset) {
      throw new Error('Sample dataset not found');
    }
    if (!(name in SampleDatasetName)) {
      throw new Error('Invalid sample dataset name');
    }
    const eventName = TelemetryEvent.CONNECTION_START_SAMPLE_DATASET;
    const eventProperties = {
      datasetName: name,
    };
    try {
      // create duckdb datasource
      const initSql = buildInitSql(name as SampleDatasetName);
      const duckdbDatasourceProperties = {
        initSql,
        extensions: [],
        configurations: {},
      };
      await this.saveDataSource(
        _root,
        {
          data: {
            type: DataSourceName.DUCKDB,
            properties: duckdbDatasourceProperties,
          } as DataSource,
        },
        ctx,
      );
      const project = await ctx.projectService.getCurrentProject();

      // list all the tables in the data source
      const tables = await this.listDataSourceTables(_root, _arg, ctx);
      const tableNames = tables.map((table) => table.name);

      // save tables as model and modelColumns
      await this.overwriteModelsAndColumns(tableNames, ctx, project);

      await ctx.modelService.updatePrimaryKeys(dataset.tables);
      await ctx.modelService.batchUpdateModelProperties(dataset.tables);
      await ctx.modelService.batchUpdateColumnProperties(dataset.tables);

      // save relations
      const relations = getRelations(name as SampleDatasetName);
      const models = await ctx.modelRepository.findAll();
      const columns = await ctx.modelColumnRepository.findAll();
      const mappedRelations = this.buildRelationInput(
        relations,
        models,
        columns,
      );
      await ctx.modelService.saveRelations(mappedRelations);

      // mark current project as using sample dataset
      await ctx.projectRepository.updateOne(project.id, {
        sampleDataset: name,
      });
      await this.deploy(ctx);
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
      return { name };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { ...eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getOnboardingStatus(_root: any, _arg: any, ctx: IContext) {
    let project: Project | null;
    try {
      project = await ctx.projectRepository.getCurrentProject();
    } catch (_err: any) {
      return {
        status: OnboardingStatusEnum.NOT_STARTED,
      };
    }
    const { id, sampleDataset } = project;
    if (sampleDataset) {
      return {
        status: OnboardingStatusEnum.WITH_SAMPLE_DATASET,
      };
    }
    const models = await ctx.modelRepository.findAllBy({ projectId: id });
    if (!models.length) {
      return {
        status: OnboardingStatusEnum.DATASOURCE_SAVED,
      };
    } else {
      return {
        status: OnboardingStatusEnum.ONBOARDING_FINISHED,
      };
    }
  }

  public async saveDataSource(
    _root: any,
    args: {
      data: DataSource;
    },
    ctx: IContext,
  ) {
    const { type, properties } = args.data;
    if (type === DataSourceName.DENODO_MCP) {
      startDataSourceSetupProgressWithMode(type, 'denodo_connection');
    } else {
      startDataSourceSetupProgress(type);
    }
    const eventName = TelemetryEvent.CONNECTION_SAVE_DATA_SOURCE;
    const eventProperties = {
      dataSourceType: type,
    };

    let project: Project | null = null;
    try {
      // Currently only can create one project
      updateDataSourceSetupProgress(
        'RESETTING_PROJECT',
        '正在清理旧项目和已有语义资产',
      );
      await this.resetCurrentProject(_root, args, ctx);

      const { displayName, ...connectionInfo } = properties;
      updateDataSourceSetupProgress(
        'CREATING_PROJECT',
        '正在创建项目并初始化默认看板',
      );
      project = await ctx.projectService.createProject({
        displayName,
        type,
        connectionInfo,
      } as ProjectData);
      logger.debug(`Project created.`);

      // init dashboard
      logger.debug('Dashboard init...');
      await ctx.dashboardService.initDashboard();
      logger.debug('Dashboard created.');

      // handle duckdb connection
      if (type === DataSourceName.DUCKDB) {
        updateDataSourceSetupProgress('CONNECTING', '正在准备 DuckDB 运行环境');
        connectionInfo as DUCKDB_CONNECTION_INFO;
        await this.buildDuckDbEnvironment(ctx, {
          initSql: connectionInfo.initSql,
          extensions: connectionInfo.extensions,
          configurations: connectionInfo.configurations,
        });
      } else if (type === DataSourceName.DENODO_MCP) {
        updateDataSourceSetupProgress(
          'CONNECTING',
          '正在连接 Denodo MCP 并读取可用视图',
        );
        await ctx.projectService.getProjectDataSourceTables(project);
        const version =
          await ctx.projectService.getProjectDataSourceVersion(project);
        await ctx.projectService.updateProject(project.id, {
          version,
        });
        updateDataSourceSetupProgress(
          'FINALIZING',
          '正在完成连接初始化并准备视图选择',
        );
        await this.ensureDefaultDenodoInstruction(project.id, ctx);
        completeDataSourceSetupProgress(
          'Denodo 连接已完成，请先选择要纳入语义层的视图',
        );
      } else {
        // handle other data source
        updateDataSourceSetupProgress(
          'CONNECTING',
          '正在连接数据源并读取可用表',
        );
        await ctx.projectService.getProjectDataSourceTables(project);
        const version =
          await ctx.projectService.getProjectDataSourceVersion(project);
        await ctx.projectService.updateProject(project.id, {
          version,
        });
        logger.debug(`Data source tables fetched`);
        updateDataSourceSetupProgress('FINALIZING', '正在完成项目初始化');
      }
      if (type !== DataSourceName.DENODO_MCP) {
        completeDataSourceSetupProgress('数据源初始化完成');
      }
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
    } catch (err) {
      logger.error(
        'Failed to get project tables',
        JSON.stringify(err, null, 2),
      );
      if (project?.id) {
        await ctx.projectRepository.deleteOne(project.id);
      }
      failDataSourceSetupProgress(
        err.message,
        '数据源初始化失败，请检查连接配置或稍后重试',
      );
      ctx.telemetry.sendEvent(
        eventName,
        { eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }

    return {
      type: project.type,
      properties: {
        displayName: project.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(project),
      },
    };
  }

  private async ensureDefaultDenodoInstruction(
    projectId: number,
    ctx: IContext,
  ) {
    const existingDefaultInstruction =
      await ctx.instructionRepository.findOneBy({
        projectId,
        isDefault: true,
      } as any);

    if (existingDefaultInstruction) {
      return;
    }

    try {
      await ctx.instructionService.createInstruction({
        projectId,
        instruction: DEFAULT_DENODO_SQL_INSTRUCTION,
        questions: [],
        isDefault: true,
      });
    } catch (error: any) {
      logger.warn(
        `Failed to create default Denodo instruction for project ${projectId}: ${error.message}`,
      );
    }
  }

  public async updateDataSource(
    _root: any,
    args: { data: DataSource },
    ctx: IContext,
  ) {
    const { properties } = args.data;
    const { displayName, ...connectionInfo } = properties;
    const project = await ctx.projectService.getCurrentProject();
    const dataSourceType = project.type;

    // only new connection info needed to encrypt
    const toUpdateConnectionInfo = encryptConnectionInfo(
      dataSourceType,
      connectionInfo as any,
    );

    if (dataSourceType === DataSourceName.DUCKDB) {
      // prepare duckdb environment in wren-engine
      const { initSql, extensions, configurations } =
        toUpdateConnectionInfo as DUCKDB_CONNECTION_INFO;
      await this.buildDuckDbEnvironment(ctx, {
        initSql,
        extensions,
        configurations,
      });
    } else {
      const updatedProject = {
        ...project,
        displayName,
        connectionInfo: {
          ...project.connectionInfo,
          ...toUpdateConnectionInfo,
        },
      } as Project;

      await ctx.projectService.getProjectDataSourceTables(updatedProject);
      logger.debug(`Data source tables fetched`);
    }
    const updatedProject = await ctx.projectRepository.updateOne(project.id, {
      displayName,
      connectionInfo: { ...project.connectionInfo, ...toUpdateConnectionInfo },
    });
    if (dataSourceType === DataSourceName.DENODO_MCP) {
      await this.ensureDefaultDenodoInstruction(updatedProject.id, ctx);
      const selectedViews = await this.resolveDenodoSelectedViews(
        updatedProject,
        ctx,
      );
      if (selectedViews.length) {
        startDataSourceSetupProgressWithMode(
          dataSourceType,
          'denodo_semantic_refresh',
        );
        try {
          updateDataSourceSetupProgress(
            'FETCHING_SCHEMA',
            '正在拉取最新 Denodo Schema',
          );
          await this.refreshDenodoSemanticAssetsForProject(
            updatedProject,
            ctx,
            {
              selectedViews,
            },
          );
          completeDataSourceSetupProgress(
            isDenodoSemanticDictionaryEnabled()
              ? '核心语义层已刷新，Semantic Dictionary 已转入后台构建'
              : '核心语义层已刷新，Semantic Dictionary 已暂时禁用',
          );
        } catch (error: any) {
          failDataSourceSetupProgress(
            error.message,
            '刷新 Denodo 语义资产失败',
          );
          throw error;
        }
      }
    }
    return {
      type: updatedProject.type,
      properties: {
        displayName: updatedProject.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(updatedProject),
      },
    };
  }

  public async refreshDenodoSemanticAssets(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<boolean> {
    const project = await ctx.projectService.getCurrentProject();
    if (project.type !== DataSourceName.DENODO_MCP) {
      throw new Error('Current project is not a Denodo MCP project');
    }

    const selectedViews = await this.resolveDenodoSelectedViews(project, ctx);
    if (!selectedViews.length) {
      throw new Error('请先选择要纳入语义层的 Denodo 视图后再刷新');
    }

    startDataSourceSetupProgressWithMode(
      project.type,
      'denodo_semantic_refresh',
    );
    try {
      updateDataSourceSetupProgress(
        'FETCHING_SCHEMA',
        '正在拉取最新 Denodo Schema',
      );
      await this.refreshDenodoSemanticAssetsForProject(project, ctx, {
        selectedViews,
      });
      completeDataSourceSetupProgress(
        isDenodoSemanticDictionaryEnabled()
          ? '核心语义资产已刷新，Semantic Dictionary 已转入后台构建'
          : '核心语义资产已刷新，Semantic Dictionary 已暂时禁用',
      );
    } catch (error: any) {
      failDataSourceSetupProgress(error.message, 'Denodo 语义资产刷新失败');
      throw error;
    }
    return true;
  }

  public async getDataSourceSetupProgress(
    _root: any,
    _args: any,
    ctx: IContext,
  ) {
    const inMemoryProgress = getDataSourceSetupProgress();
    if (inMemoryProgress.status !== 'IDLE') {
      return inMemoryProgress;
    }

    try {
      const project = await ctx.projectService.getCurrentProject();
      if (project.type !== DataSourceName.DENODO_MCP) {
        return inMemoryProgress;
      }

      const dictionaryJob = isDenodoSemanticDictionaryEnabled()
        ? await ctx.semanticDictionaryBuildJobRepository.getByProjectId(
            project.id,
          )
        : null;
      return (
        buildDataSourceSetupProgressFromSemanticDictionaryJob(dictionaryJob) ||
        inMemoryProgress
      );
    } catch {
      return inMemoryProgress;
    }
  }

  public async listDataSourceTables(_root: any, _arg, ctx: IContext) {
    return await ctx.projectService.getProjectDataSourceTables();
  }

  public async saveTables(
    _root: any,
    arg: {
      data: { tables: string[] };
    },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_TABLES;

    // get current project
    const project = await ctx.projectService.getCurrentProject();
    try {
      let models;
      let columns;
      if (project.type === DataSourceName.DENODO_MCP) {
        ({ models, columns } = await this.refreshDenodoSemanticAssetsForProject(
          project,
          ctx,
          {
            selectedViews: arg.data.tables,
          },
        ));
      } else {
        ({ models, columns } = await this.overwriteModelsAndColumns(
          arg.data.tables,
          ctx,
          project,
        ));
        // async deploy to wren-engine and ai service
        this.deploy(ctx);
      }
      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        dataSourceType: project.type,
        tablesCount: models.length,
        columnsCount: columns.length,
      });

      return { models: models, columns };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async autoGenerateRelation(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();

    // get models and columns
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((m) => m.id);
    const columns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const constraints =
      await ctx.projectService.getProjectSuggestedConstraint(project);

    // generate relation
    const relations = [];
    for (const constraint of constraints) {
      const {
        constraintTable,
        constraintColumn,
        constraintedTable,
        constraintedColumn,
      } = constraint;
      // validate tables and columns exists in our models and model columns
      const fromModel = models.find(
        (m) => m.sourceTableName === constraintTable,
      );
      const toModel = models.find(
        (m) => m.sourceTableName === constraintedTable,
      );
      if (!fromModel || !toModel) {
        continue;
      }
      const fromColumn = columns.find(
        (c) =>
          c.modelId === fromModel.id && c.sourceColumnName === constraintColumn,
      );
      const toColumn = columns.find(
        (c) =>
          c.modelId === toModel.id && c.sourceColumnName === constraintedColumn,
      );
      if (!fromColumn || !toColumn) {
        continue;
      }
      // create relation
      const relation: AnalysisRelationInfo = {
        // upper case the first letter of the sourceTableName
        name: constraint.constraintName,
        fromModelId: fromModel.id,
        fromModelReferenceName: fromModel.referenceName,
        fromColumnId: fromColumn.id,
        fromColumnReferenceName: fromColumn.referenceName,
        toModelId: toModel.id,
        toModelReferenceName: toModel.referenceName,
        toColumnId: toColumn.id,
        toColumnReferenceName: toColumn.referenceName,
        // TODO: add join type
        type: RelationType.ONE_TO_MANY,
      };
      relations.push(relation);
    }
    // group by model
    return models.map(({ id, displayName, referenceName }) => ({
      id,
      displayName,
      referenceName,
      relations: relations.filter(
        (relation) =>
          relation.fromModelId === id &&
          // exclude self-referential relationship
          relation.toModelId !== relation.fromModelId,
      ),
    }));
  }

  public async saveRelations(
    _root: any,
    arg: { data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_RELATION;
    try {
      const savedRelations = await ctx.modelService.saveRelations(
        arg.data.relations,
      );
      // async deploy
      this.deploy(ctx);
      ctx.telemetry.sendEvent(eventName, {
        relationCount: savedRelations.length,
      });
      return savedRelations;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getSchemaChange(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const lastSchemaChange =
      await ctx.schemaChangeRepository.findLastSchemaChange(project.id);

    if (!lastSchemaChange) {
      return {
        deletedTables: null,
        deletedColumns: null,
        modifiedColumns: null,
        lastSchemaChangeTime: null,
      };
    }

    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((model) => model.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);

    const modelRelationships = await ctx.relationRepository.findRelationInfoBy({
      modelIds,
    });

    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });

    const resolves = lastSchemaChange.resolve;
    const unresolvedChanges = Object.keys(resolves).reduce((result, key) => {
      const isResolved = resolves[key];
      const changes = lastSchemaChange.change[key];
      // return if resolved or no changes
      if (isResolved || !changes) return result;

      // Mapping with affected models and columns and affected calculated fields and relationships data into schema change
      const affecteds = schemaDetector.getAffectedResources(changes, {
        models,
        modelColumns,
        modelRelationships,
      });

      const affectedChanges = affecteds.length ? affecteds : null;
      return { ...result, [key]: affectedChanges };
    }, {});

    return {
      ...unresolvedChanges,
      lastSchemaChangeTime: lastSchemaChange.createdAt,
    };
  }

  public async triggerDataSourceDetection(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_DETECT_SCHEMA_CHANGE;
    try {
      const hasSchemaChange = await schemaDetector.detectSchemaChange();
      ctx.telemetry.sendEvent(eventName, { hasSchemaChange });
      return hasSchemaChange;
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
  }

  public async resolveSchemaChange(
    _root: any,
    arg: { where: { type: SchemaChangeType } },
    ctx: IContext,
  ) {
    const { type } = arg.where;
    const project = await ctx.projectService.getCurrentProject();
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_RESOLVE_SCHEMA_CHANGE;
    try {
      await schemaDetector.resolveSchemaChange(type);
      ctx.telemetry.sendEvent(eventName, { type });
    } catch (error) {
      ctx.telemetry.sendEvent(
        eventName,
        { type, error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
    return true;
  }

  private async deploy(ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    const deployRes = await ctx.deployService.deploy(manifest, project.id);

    // only generating for user's data source
    if (project.sampleDataset === null) {
      await ctx.projectService.generateProjectRecommendationQuestions();
    }
    return deployRes;
  }

  private async getCurrentDenodoModelSourceTables(
    projectId: number,
    ctx: IContext,
  ): Promise<string[]> {
    const models = await ctx.modelRepository.findAllBy({ projectId });
    return normalizeDenodoSelectedViews(
      models.map((model) => model.sourceTableName),
    );
  }

  private async resolveDenodoSelectedViews(
    project: Project,
    ctx: IContext,
  ): Promise<string[]> {
    const connectionInfo = project.connectionInfo as DENODO_MCP_CONNECTION_INFO;
    const selectedViews = normalizeDenodoSelectedViews(
      connectionInfo?.selectedViews,
    );
    if (selectedViews.length) {
      return selectedViews;
    }

    const derivedSelectedViews = await this.getCurrentDenodoModelSourceTables(
      project.id,
      ctx,
    );
    if (!derivedSelectedViews.length) {
      return [];
    }

    await ctx.projectRepository.updateOne(project.id, {
      connectionInfo: {
        ...project.connectionInfo,
        selectedViews: derivedSelectedViews,
      },
    });
    return derivedSelectedViews;
  }

  private validateDenodoSelectedViews(
    selectedViews: string[],
    compactTables: CompactTable[],
  ): string[] {
    const normalizedSelectedViews = normalizeDenodoSelectedViews(selectedViews);
    if (!normalizedSelectedViews.length) {
      throw new Error('请至少选择一个 Denodo 视图来构建语义层');
    }

    const tableNameSet = new Set(
      compactTables.map((table) => table.name.toLowerCase()),
    );
    const missingViews = normalizedSelectedViews.filter(
      (view) => !tableNameSet.has(view.toLowerCase()),
    );
    if (missingViews.length) {
      throw new Error(
        `选定的 Denodo 视图在最新 Schema 中不存在: ${missingViews.join(', ')}`,
      );
    }

    return normalizedSelectedViews;
  }

  private async refreshDenodoSemanticAssetsForProject(
    project: Project,
    ctx: IContext,
    options?: {
      selectedViews?: string[];
    },
  ): Promise<{
    rawSchema: Record<string, any>;
    manifest: Manifest;
    models: Model[];
    columns: ModelColumn[];
    selectedViews: string[];
  }> {
    const connectionInfo = toIbisConnectionInfo(
      project.type,
      project.connectionInfo,
    ) as DENODO_MCP_CONNECTION_INFO;

    updateDataSourceSetupProgress(
      'FETCHING_SCHEMA',
      '正在从 Denodo MCP 拉取最新 Schema',
    );
    const rawSchema =
      await ctx.denodoMcpAdaptor.getDatabaseSchema(connectionInfo);
    updateDataSourceSetupProgress(
      'BUILDING_MODELS',
      '正在根据 Schema 生成模型与字段',
    );
    const compactTables = toDenodoCompactTables(rawSchema);
    const selectedViews = this.validateDenodoSelectedViews(
      options?.selectedViews ||
        (await this.resolveDenodoSelectedViews(project, ctx)),
      compactTables,
    );
    const version =
      await ctx.projectService.getProjectDataSourceVersion(project);

    await ctx.projectService.updateProject(project.id, {
      version,
      connectionInfo: {
        ...project.connectionInfo,
        selectedViews,
      },
    });
    const { models, columns } = await this.overwriteModelsAndColumns(
      selectedViews,
      ctx,
      project,
      compactTables,
    );

    updateDataSourceSetupProgress(
      'BUILDING_MANIFEST',
      '正在拉取 Denodo 视图关联并同步建模关系',
    );
    const modelReferenceMap = models.reduce(
      (acc, model) => {
        acc[model.sourceTableName.toLowerCase()] = model.referenceName;
        return acc;
      },
      {} as Record<string, string>,
    );
    const columnReferenceMap = columns.reduce(
      (acc, column) => {
        const model = models.find((item) => item.id === column.modelId);
        if (!model) return acc;
        const modelKey = model.sourceTableName.toLowerCase();
        acc[modelKey] = acc[modelKey] || {};
        acc[modelKey][column.sourceColumnName.toLowerCase()] =
          column.referenceName;
        return acc;
      },
      {} as Record<string, Record<string, string>>,
    );
    const associations = (
      await Promise.all(
        selectedViews.map(async (viewName) => {
          try {
            return await ctx.denodoMcpAdaptor.getViewAssociations(
              connectionInfo,
              viewName,
            );
          } catch (error: any) {
            logger.warn(
              `Failed to fetch Denodo associations for project ${project.id}, view ${viewName}: ${error.message}`,
            );
            return [];
          }
        }),
      )
    ).flat();
    const { relationships, warnings } = toDenodoManifestRelationships({
      associations,
      selectedViews,
      modelReferenceMap,
      columnReferenceMap,
    });
    warnings.forEach((warning) => {
      logger.warn(
        `Skip Denodo association while building manifest for project ${project.id}: ${warning}`,
      );
    });
    await this.syncDenodoAssociationRelations({
      projectId: project.id,
      models,
      columns,
      relationships,
      ctx,
    });

    updateDataSourceSetupProgress(
      'BUILDING_MANIFEST',
      '正在构建语义层 Manifest',
    );
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    const manifestRelationshipNames = new Set(
      (manifest.relationships || [])
        .map((relationship) => relationship?.name?.trim())
        .filter((name): name is string => Boolean(name))
        .map((name) => name.toLowerCase()),
    );
    manifest.relationships = [
      ...(manifest.relationships || []),
      ...relationships.filter(
        (relationship) =>
          !manifestRelationshipNames.has(relationship.name.toLowerCase()),
      ),
    ];

    updateDataSourceSetupProgress(
      'WRITING_ARTIFACTS',
      '正在写入 raw schema 和 manifest',
    );
    await writeDenodoSemanticArtifacts({
      projectId: project.id,
      rawSchema: filterDenodoRawSchemaViews(rawSchema, selectedViews),
      manifest,
      semanticDictionary: isDenodoSemanticDictionaryEnabled()
        ? undefined
        : null,
    });

    updateDataSourceSetupProgress('DEPLOYING', '正在部署语义层并准备问答能力');
    await this.deploy(ctx);
    updateDataSourceSetupProgress('FINALIZING', '正在完成默认规则和项目初始化');
    await this.ensureDefaultDenodoInstruction(project.id, ctx);

    return { rawSchema, manifest, models, columns, selectedViews };
  }

  private buildRelationInput(
    relations: SampleDatasetRelationship[],
    models: Model[],
    columns: ModelColumn[],
  ) {
    const relationInput = relations.map((relation) => {
      const { fromModelName, fromColumnName, toModelName, toColumnName, type } =
        relation;
      const fromModelId = models.find(
        (model) => model.sourceTableName === fromModelName,
      )?.id;
      const toModelId = models.find(
        (model) => model.sourceTableName === toModelName,
      )?.id;
      if (!fromModelId || !toModelId) {
        throw new Error(
          `Model not found, fromModelName "${fromModelName}" to toModelName: "${toModelName}"`,
        );
      }

      const fromColumnId = columns.find(
        (column) =>
          column.referenceName === fromColumnName &&
          column.modelId === fromModelId,
      )?.id;
      const toColumnId = columns.find(
        (column) =>
          column.referenceName === toColumnName && column.modelId === toModelId,
      )?.id;
      if (!fromColumnId || !toColumnId) {
        throw new Error(
          `Column not found fromColumnName: ${fromColumnName} toColumnName: ${toColumnName}`,
        );
      }
      return {
        fromModelId,
        fromColumnId,
        toModelId,
        toColumnId,
        type,
        description: relation.description,
      } as RelationData;
    });
    return relationInput;
  }

  private async overwriteModelsAndColumns(
    tables: string[],
    ctx: IContext,
    project: Project,
    compactTables?: CompactTable[],
  ) {
    // delete existing models and columns
    await ctx.modelService.deleteAllModelsByProjectId(project.id);

    const sourceTables =
      compactTables ||
      ((await ctx.projectService.getProjectDataSourceTables(
        project,
      )) as CompactTable[]);

    const selectedTables = sourceTables.filter((table) =>
      tables.includes(table.name),
    );

    // create models
    const modelValues = selectedTables.map((table) => {
      const properties = table?.properties;
      // compactTable contain schema and catalog, these information are for building tableReference in mdl
      const model = {
        projectId: project.id,
        displayName: table.name, // use table name as displayName, referenceName and tableName
        referenceName: replaceInvalidReferenceName(table.name),
        sourceTableName: table.name,
        cached: false,
        refreshTime: null,
        properties: properties ? JSON.stringify(properties) : null,
      } as Partial<Model>;
      return model;
    });
    const models = await ctx.modelRepository.createMany(modelValues);

    // create columns
    const columnValues = selectedTables.flatMap((table) => {
      const compactColumns = table.columns;
      const primaryKey = table.primaryKey;
      const model = models.find((m) => m.sourceTableName === table.name);
      return compactColumns.map(
        (column) =>
          ({
            modelId: model.id,
            isCalculated: false,
            displayName: column.name,
            referenceName: transformInvalidColumnName(column.name),
            sourceColumnName: column.name,
            type: column.type || 'string',
            notNull: column.notNull || false,
            isPk: primaryKey === column.name,
            properties: column.properties
              ? JSON.stringify(column.properties)
              : null,
          }) as Partial<ModelColumn>,
      );
    });
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    // create nested columns
    const compactColumns = selectedTables.flatMap((table) => table.columns);
    const nestedColumnValues = compactColumns.flatMap((compactColumn) => {
      const column = columns.find(
        (c) => c.sourceColumnName === compactColumn.name,
      );
      return handleNestedColumns(compactColumn, {
        modelId: column.modelId,
        columnId: column.id,
        sourceColumnName: column.sourceColumnName,
      });
    });
    await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);

    return { models, columns };
  }

  private async syncDenodoAssociationRelations({
    projectId,
    models,
    columns,
    relationships,
    ctx,
  }: {
    projectId: number;
    models: Model[];
    columns: ModelColumn[];
    relationships: Partial<Manifest['relationships'][number]>[];
    ctx: IContext;
  }) {
    const modelIdByReference = new Map(
      models.map((model) => [model.referenceName.toLowerCase(), model.id]),
    );
    const columnIdByModelAndReference = new Map(
      columns.map((column) => {
        const model = models.find((item) => item.id === column.modelId);
        return [
          `${model?.referenceName.toLowerCase()}.${column.referenceName.toLowerCase()}`,
          column.id,
        ] as const;
      }),
    );
    const relationValues: Partial<Relation>[] = [];

    relationships.forEach((relationship) => {
      if (!relationship?.name || !relationship.condition || !relationship.joinType) {
        return;
      }

      if (relationship.joinType === 'MANY_TO_MANY') {
        logger.warn(
          `Skip syncing MANY_TO_MANY Denodo association "${relationship.name}" into relationRepository`,
        );
        return;
      }

      const firstClause = relationship.condition
        .split(/\s+AND\s+/iu)
        .map((item) => item.trim())
        .find(Boolean);
      const clauseMatch = firstClause?.match(
        /^"([^"]+)"\.([A-Za-z0-9_]+)\s*=\s*"([^"]+)"\.([A-Za-z0-9_]+)$/u,
      );
      if (!clauseMatch) {
        logger.warn(
          `Skip syncing Denodo association "${relationship.name}" because the condition is not repository-compatible: ${relationship.condition}`,
        );
        return;
      }

      const [, fromModelName, fromColumnName, toModelName, toColumnName] =
        clauseMatch;
      const fromModelId = modelIdByReference.get(fromModelName.toLowerCase());
      const toModelId = modelIdByReference.get(toModelName.toLowerCase());
      const fromColumnId = columnIdByModelAndReference.get(
        `${fromModelName.toLowerCase()}.${fromColumnName.toLowerCase()}`,
      );
      const toColumnId = columnIdByModelAndReference.get(
        `${toModelName.toLowerCase()}.${toColumnName.toLowerCase()}`,
      );

      if (!fromModelId || !toModelId || !fromColumnId || !toColumnId) {
        logger.warn(
          `Skip syncing Denodo association "${relationship.name}" because the mapped model/column ids cannot be resolved`,
        );
        return;
      }

      relationValues.push({
        projectId,
        name: relationship.name,
        joinType: relationship.joinType,
        condition: relationship.condition,
        fromColumnId,
        toColumnId,
        properties: JSON.stringify({
          ...(relationship.properties || {}),
          source: DENODO_ASSOCIATION_SOURCE,
        }),
      });
    });

    if (!relationValues.length) {
      return;
    }

    await ctx.relationRepository.createMany(relationValues);
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return trim(`${installExtensions}\n${initSql}`);
  }

  private async buildDuckDbEnvironment(
    ctx: IContext,
    options: {
      initSql: string;
      extensions: string[];
      configurations: Record<string, any>;
    },
  ): Promise<void> {
    const { initSql, extensions, configurations } = options;
    const initSqlWithExtensions = this.concatInitSql(initSql, extensions);
    await ctx.wrenEngineAdaptor.prepareDuckDB({
      sessionProps: configurations,
      initSql: initSqlWithExtensions,
    } as DuckDBPrepareOptions);

    // check can list dataset table
    await ctx.wrenEngineAdaptor.listTables();

    // patch wren-engine config
    const config = {
      'wren.datasource.type': 'duckdb',
    };
    await ctx.wrenEngineAdaptor.patchConfig(config);
  }
}
