import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import type { MetricFormula } from '@server/models/metricFormula';

const logger = getLogger('API_METRIC_FORMULA_BY_ID');
logger.level = 'debug';

const { projectService, metricFormulaService } = components;

const validateFormulaId = (id: unknown): string => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Metric formula id is required', 400);
  }
  return id;
};

const toApiError = (error: any): ApiError => {
  if (error instanceof ApiError) return error;

  const message = error?.message || 'Metric formula operation failed';
  if (message.includes('already exists')) return new ApiError(message, 409);
  if (message.includes('not found')) return new ApiError(message, 404);
  if (
    message.includes('required') ||
    message.includes('must include') ||
    message.includes('parse')
  ) {
    return new ApiError(message, 400);
  }
  return new ApiError(message, 500);
};

const handleUpdateMetricFormula = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  try {
    const id = validateFormulaId(req.query.id);
    const formula = await metricFormulaService.updateFormula(
      id,
      req.body as Partial<MetricFormula>,
    );
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: formula,
      projectId: project.id,
      apiType: ApiType.UPDATE_METRIC_FORMULA,
      startTime,
      requestPayload: req.body,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    throw toApiError(error);
  }
};

const handleDeleteMetricFormula = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  try {
    const id = validateFormulaId(req.query.id);
    await metricFormulaService.deleteFormula(id);
    await respondWithSimple({
      res,
      statusCode: 204,
      responsePayload: {},
      projectId: project.id,
      apiType: ApiType.DELETE_METRIC_FORMULA,
      startTime,
      requestPayload: { id },
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    throw toApiError(error);
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let project;

  try {
    project = await projectService.getCurrentProject();

    if (req.method === 'PUT') {
      await handleUpdateMetricFormula(req, res, project, startTime);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteMetricFormula(req, res, project, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType:
        req.method === 'PUT'
          ? ApiType.UPDATE_METRIC_FORMULA
          : ApiType.DELETE_METRIC_FORMULA,
      requestPayload: req.method === 'PUT' ? req.body : { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
