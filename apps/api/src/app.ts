import cors from 'cors';
import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import {
  ApiErrorResponseSchema,
  ApiSessionResponseSchema,
  HealthResponseSchema,
} from '@cybernexus/shared';
import {
  createApiAuthConfiguration,
  createAuthenticationMiddleware,
  loadApiAuthConfiguration,
  requireScopes,
  type ApiCredential,
} from './security/auth.js';
import {
  createRateLimitMiddleware,
  requestIdMiddleware,
  type RateLimitOptions,
} from './security/request-controls.js';
import { createAlertRouter } from './alerts/routes.js';
import { createCorrelationRouter } from './correlation/routes.js';
import {
  createCorrelationServiceClient,
  type CorrelationService,
} from './correlation/service-client.js';
import { createRelationshipRouter } from './correlation/relationship-routes.js';
import { createIncidentRouter } from './incidents/routes.js';
import { createIncidentAnalysisRouter } from './analysis/routes.js';
import {
  createIncidentAnalysisServiceClient,
  createAIServiceReadinessClient,
  type AIServiceReadinessClient,
  type IncidentAnalysisService,
} from './analysis/service-client.js';
import { createPrioritizationRouter } from './prioritization/routes.js';
import { createAssignmentRouter } from './assignments/routes.js';
import {
  createPrismaAlertRepository,
  type AlertRepository,
} from './alerts/repository.js';
import { prisma } from './db/prisma.js';
import type { PrismaClient } from '@prisma/client';
import { getDependencyHealth } from './health/dependencies.js';

export type AppOptions = {
  credentials?: readonly ApiCredential[];
  rateLimit?: Partial<RateLimitOptions>;
  alertRepository?: AlertRepository;
  database?: PrismaClient;
  correlationService?: CorrelationService;
  incidentAnalysisService?: IncidentAnalysisService;
  aiServiceReadiness?: AIServiceReadinessClient;
};

export function createApp(options: AppOptions = {}): express.Express {
  const app: express.Express = express();
  const authConfiguration =
    options.credentials === undefined
      ? loadApiAuthConfiguration()
      : createApiAuthConfiguration(options.credentials);
  const database = options.database ?? prisma;
  const alertRepository =
    options.alertRepository ?? createPrismaAlertRepository(database);
  const correlationService =
    options.correlationService ?? createCorrelationServiceClient();
  const incidentAnalysisService =
    options.incidentAnalysisService ?? createIncidentAnalysisServiceClient();
  const aiServiceReadiness =
    options.aiServiceReadiness ?? createAIServiceReadinessClient();

  app.use(requestIdMiddleware);
  app.use(
    cors({
      origin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173',
      exposedHeaders: [
        'X-Request-ID',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'Retry-After',
      ],
    }),
  );
  app.use('/api/v1', createRateLimitMiddleware(options.rateLimit));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) =>
    response.json(
      HealthResponseSchema.parse({ status: 'ok', service: 'cybernexus-api' }),
    ),
  );
  app.get(
    '/health/dependencies',
    createRateLimitMiddleware(options.rateLimit),
    async (_request, response, next) => {
      try {
        response.json(await getDependencyHealth(database, aiServiceReadiness));
      } catch {
        next(new Error('Dependency health check failed.'));
      }
    },
  );

  const versionedApi = express.Router();
  versionedApi.use(createAuthenticationMiddleware(authConfiguration));
  versionedApi.get(
    '/session',
    requireScopes('api:read'),
    (_request, response) =>
      response.json(ApiSessionResponseSchema.parse(response.locals.principal)),
  );
  versionedApi.use('/alerts', createAlertRouter(alertRepository));
  versionedApi.use(
    '/correlation',
    createCorrelationRouter(database, correlationService),
  );
  versionedApi.use(
    '/incidents',
    createIncidentAnalysisRouter(database, incidentAnalysisService),
  );
  versionedApi.use('/incidents', createPrioritizationRouter(database));
  versionedApi.use('/assignments', createAssignmentRouter(database));
  versionedApi.use('/incidents', createIncidentRouter(database));
  versionedApi.use('/relationships', createRelationshipRouter(database));
  app.use('/api/v1', versionedApi);

  app.use((_request, response) =>
    response.status(404).json(
      ApiErrorResponseSchema.parse({
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource was not found.',
        },
      }),
    ),
  );

  app.use(apiErrorHandler);
  return app;
}

export function validateBody(schema: z.ZodType): RequestHandler {
  return (request, response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request body did not match the expected format.',
            details: result.error.issues.slice(0, 100).map((issue) => ({
              path: issue.path
                .slice(0, 32)
                .map((part) =>
                  typeof part === 'string' ? part.slice(0, 200) : part,
                ),
              message: issue.message.slice(0, 1000),
            })),
          },
        }),
      );
      return;
    }

    request.body = result.data;
    next();
  };
}

export const apiErrorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? error.status
      : undefined;
  const malformedJson = error instanceof SyntaxError && 'body' in error;
  const bodyTooLarge = status === 413;
  const code = malformedJson
    ? 'MALFORMED_JSON'
    : bodyTooLarge
      ? 'VALIDATION_ERROR'
      : 'INTERNAL_SERVER_ERROR';
  const message = malformedJson
    ? 'Request body must contain valid JSON.'
    : bodyTooLarge
      ? 'Request body exceeds the configured size limit.'
      : 'An unexpected error occurred.';

  response
    .status(malformedJson ? 400 : bodyTooLarge ? 413 : 500)
    .json(ApiErrorResponseSchema.parse({ error: { code, message } }));
};

export const app = createApp();
