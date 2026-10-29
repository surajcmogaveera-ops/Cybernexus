import type { PrismaClient } from '@prisma/client';
import {
  ApiErrorResponseSchema,
  ApiGatewayErrorResponseSchema,
} from '@cybernexus/shared';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { requireScopes } from '../security/auth.js';
import { CorrelationRunRequestSchema } from './contracts.js';
import {
  CorrelationInputNotFoundError,
  InvalidCorrelationServiceResponseError,
  runCorrelationWorkflow,
} from './workflow.js';
import {
  CorrelationServiceUnavailable,
  type CorrelationService,
} from './service-client.js';

type Principal = { subject: string };

export function createCorrelationRouter(
  database: PrismaClient,
  service: CorrelationService,
): Router {
  const router = Router();
  router.post('/run', requireScopes('api:write'), (request, response, next) =>
    runCorrelation(request, response, next, database, service),
  );
  return router;
}

async function runCorrelation(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
  service: CorrelationService,
): Promise<void> {
  const parsed = CorrelationRunRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json(
      ApiErrorResponseSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Request did not match the supported correlation API format.',
          details: parsed.error.issues
            .slice(0, 100)
            .map(({ path, message }) => ({
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
  try {
    const result = await runCorrelationWorkflow(
      database,
      service,
      parsed.data.alertIds,
      (response.locals.principal as Principal).subject,
    );
    response.status(200).json(result);
  } catch (error) {
    if (error instanceof CorrelationInputNotFoundError) {
      response.status(404).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'NOT_FOUND',
            message: 'One or more requested alerts were not found.',
          },
        }),
      );
      return;
    }
    if (error instanceof CorrelationServiceUnavailable) {
      response.status(503).json(
        ApiGatewayErrorResponseSchema.parse({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Correlation service is unavailable.',
          },
        }),
      );
      return;
    }
    if (error instanceof InvalidCorrelationServiceResponseError) {
      response.status(502).json(
        ApiGatewayErrorResponseSchema.parse({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Correlation service returned an invalid response.',
          },
        }),
      );
      return;
    }
    next(error);
  }
}
