import type { PrismaClient } from '@prisma/client';
import {
  ApiErrorResponseSchema,
  ApiGatewayErrorResponseSchema,
  IdentifierSchema,
} from '@cybernexus/shared';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { requireScopes } from '../security/auth.js';
import {
  InvalidAnalysisEvidenceError,
  RequestIncidentAnalysisSchema,
} from './contracts.js';
import {
  IncidentAnalysisNoAlertsError,
  IncidentAnalysisNotFoundError,
  getStoredIncidentAnalysis,
  runIncidentAnalysis,
} from './workflow.js';
import {
  AnalysisServiceUnavailable,
  InvalidAnalysisServiceResponse,
  type IncidentAnalysisService,
} from './service-client.js';

type Principal = { subject: string };

export function createIncidentAnalysisRouter(
  database: PrismaClient,
  service: IncidentAnalysisService,
): Router {
  const router = Router();
  router.post(
    '/:incidentId/analysis',
    requireScopes('api:write'),
    (request, response, next) =>
      requestIncidentAnalysis(request, response, next, database, service),
  );
  router.get(
    '/:incidentId/analysis',
    requireScopes('api:read'),
    (request, response, next) =>
      retrieveIncidentAnalysis(request, response, next, database),
  );
  return router;
}

async function requestIncidentAnalysis(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
  service: IncidentAnalysisService,
): Promise<void> {
  const body = RequestIncidentAnalysisSchema.safeParse(request.body);
  if (!body.success) {
    response.status(400).json(
      ApiErrorResponseSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request did not match the supported analysis API format.',
          details: body.error.issues.slice(0, 100).map(({ path, message }) => ({
            path: path.filter(
              (part): part is string | number =>
                typeof part === 'string' || typeof part === 'number',
            ),
            message: message.slice(0, 1000),
          })),
        },
      }),
    );
    return;
  }
  const incidentId = pathParam(request.params.incidentId);
  if (!incidentId || !IdentifierSchema.safeParse(incidentId).success) {
    return sendNotFound(response);
  }
  try {
    const analysis = await runIncidentAnalysis(
      database,
      service,
      incidentId,
      (response.locals.principal as Principal).subject,
    );
    response.status(201).json({ analysis });
  } catch (error) {
    if (error instanceof IncidentAnalysisNotFoundError) {
      sendNotFound(response);
      return;
    }
    if (error instanceof IncidentAnalysisNoAlertsError) {
      response.status(409).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'CONFLICT',
            message: 'The incident has no linked source alerts to analyze.',
          },
        }),
      );
      return;
    }
    if (error instanceof AnalysisServiceUnavailable) {
      response.status(503).json(
        ApiGatewayErrorResponseSchema.parse({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'The incident analysis service is unavailable.',
          },
        }),
      );
      return;
    }
    if (
      error instanceof InvalidAnalysisServiceResponse ||
      error instanceof InvalidAnalysisEvidenceError
    ) {
      response.status(502).json(
        ApiGatewayErrorResponseSchema.parse({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'The incident analysis response could not be validated.',
          },
        }),
      );
      return;
    }
    next(error);
  }
}

async function retrieveIncidentAnalysis(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
): Promise<void> {
  const incidentId = pathParam(request.params.incidentId);
  if (!incidentId || !IdentifierSchema.safeParse(incidentId).success) {
    return sendNotFound(response);
  }
  const rawRunId = request.query.analysisRunId;
  if (rawRunId !== undefined && typeof rawRunId !== 'string') {
    sendValidationError(response);
    return;
  }
  if (
    typeof rawRunId === 'string' &&
    !IdentifierSchema.safeParse(rawRunId).success
  ) {
    sendValidationError(response);
    return;
  }
  try {
    const analysis = await getStoredIncidentAnalysis(
      database,
      incidentId,
      typeof rawRunId === 'string' ? rawRunId : undefined,
    );
    if (!analysis) {
      const exists = await database.incident.findUnique({
        where: { id: incidentId },
        select: { id: true },
      });
      if (!exists) return sendNotFound(response);
      response.status(404).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'NOT_FOUND',
            message: 'No completed analysis was found for the incident.',
          },
        }),
      );
      return;
    }
    response.json({ analysis });
  } catch (error) {
    if (error instanceof IncidentAnalysisNotFoundError) {
      sendNotFound(response);
      return;
    }
    next(error);
  }
}

function sendNotFound(response: Response): void {
  response.status(404).json(
    ApiErrorResponseSchema.parse({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested incident was not found.',
      },
    }),
  );
}

function sendValidationError(response: Response): void {
  response.status(400).json(
    ApiErrorResponseSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Analysis selection did not match the supported API format.',
      },
    }),
  );
}

function pathParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
