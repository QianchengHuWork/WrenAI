import { DataSourceName } from '@server/types';
import {
  Model,
  ModelColumn,
  Project,
  RelationInfo,
} from '../../repositories';
import { MDLBuilder, MDLBuilderBuildFromOptions } from '../mdlBuilder';

describe('MDLBuilder Denodo relations', () => {
  it('prefers stored relation.condition when building manifest relationships', () => {
    const models = [
      {
        id: 1,
        projectId: 1,
        displayName: 'profile',
        sourceTableName: 'profile',
        referenceName: 'profile',
        refSql: 'SELECT * FROM profile',
        cached: false,
        refreshTime: null,
        properties: JSON.stringify({ table: 'profile' }),
      },
      {
        id: 2,
        projectId: 1,
        displayName: 'assign_event',
        sourceTableName: 'assign_event',
        referenceName: 'assign_event',
        refSql: 'SELECT * FROM assign_event',
        cached: false,
        refreshTime: null,
        properties: JSON.stringify({ table: 'assign_event' }),
      },
    ] as Model[];
    const columns = [
      {
        id: 1,
        modelId: 1,
        isCalculated: false,
        displayName: 'clew_id',
        referenceName: 'clew_id',
        sourceColumnName: 'clew_id',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: true,
        properties: null,
      },
      {
        id: 2,
        modelId: 2,
        isCalculated: false,
        displayName: 'clew_id',
        referenceName: 'clew_id',
        sourceColumnName: 'clew_id',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: false,
        properties: null,
      },
    ] as ModelColumn[];
    const relations = [
      {
        id: 1,
        projectId: 1,
        name: 'assoc_profile_assign',
        joinType: 'ONE_TO_MANY',
        condition:
          '"profile".clew_id = "assign_event".clew_id AND "profile".bizline_id = "assign_event".bizline_id',
        fromColumnId: 1,
        toColumnId: 2,
        fromModelId: 1,
        fromModelName: 'profile',
        fromModelDisplayName: 'profile',
        fromColumnName: 'clew_id',
        fromColumnDisplayName: 'clew_id',
        toModelId: 2,
        toModelName: 'assign_event',
        toModelDisplayName: 'assign_event',
        toColumnName: 'clew_id',
        toColumnDisplayName: 'clew_id',
        properties: JSON.stringify({ source: 'DENODO_ASSOCIATION' }),
      },
    ] as RelationInfo[];

    const manifest = new MDLBuilder({
      project: {
        id: 1,
        type: DataSourceName.DUCKDB,
        displayName: 'my project',
        connectionInfo: null,
        catalog: 'wrenai',
        schema: 'public',
        sampleDataset: null,
      } as Project,
      models,
      columns,
      nestedColumns: [],
      relations,
      views: [],
      relatedModels: models,
      relatedColumns: columns,
      relatedRelations: relations,
    } as MDLBuilderBuildFromOptions).build();

    expect(manifest.relationships).toEqual([
      expect.objectContaining({
        name: 'assoc_profile_assign',
        condition:
          '"profile".clew_id = "assign_event".clew_id AND "profile".bizline_id = "assign_event".bizline_id',
      }),
    ]);
  });
});
