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

const logger = getLogger('API_METRIC_FORMULAS');
logger.level = 'debug';

const { projectService, metricFormulaService } = components;

const toApiError = (error: any): ApiError => {
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

const handleGetMetricFormulas = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  try {
    const formulas = await metricFormulaService.listFormulas();
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        filePath: metricFormulaService.getFilePath(),
        formulas,
      },
      projectId: project.id,
      apiType: ApiType.GET_METRIC_FORMULAS,
      startTime,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    throw toApiError(error);
  }
};

const handleCreateMetricFormula = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  try {
    const formula = await metricFormulaService.createFormula(
      req.body as Partial<MetricFormula>,
    );
    await respondWithSimple({
      res,
      statusCode: 201,
      responsePayload: formula,
      projectId: project.id,
      apiType: ApiType.CREATE_METRIC_FORMULA,
      startTime,
      requestPayload: req.body,
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

    if (req.method === 'GET') {
      await handleGetMetricFormulas(req, res, project, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleCreateMetricFormula(req, res, project, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_METRIC_FORMULAS
          : ApiType.CREATE_METRIC_FORMULA,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
