import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { ApiErrorResponseSchema } from '@cybernexus/shared';
import { requireScopes } from '../security/auth.js';
import {
  AlertBatchRequestSchema,
  AlertBatchResponseSchema,
  IdempotencyKeySchema,
  AlertIngestResponseSchema,
  AlertListQuerySchema,
  type AlertBatchResponse,
} from './contracts.js';
import {
  AlertInputValidationError,
  normalizeAlertIngress,
} from './normalization.js';
import { normalizeSeverity } from './normalization.js';
import type { AlertRepository } from './repository.js';

type AuthenticatedPrincipal = { subject: string };

export function createAlertRouter(repository: AlertRepository): Router {
  const router = Router();

  router.post(
    '/ingest',
    requireScopes('api:write'),
    (request, response, next) => ingestOne(request, response, next, repository),
  );
  router.post(
    '/upload',
    requireScopes('api:write'),
    (request, response, next) =>
      ingestBatch(request, response, next, repository),
  );
  router.get('/', requireScopes('api:read'), (request, response, next) =>
    listAlerts(request, response, next, repository),
  );

  return router;
}

async function ingestOne(
  request: Request,
  response: Response,
  next: NextFunction,
  repository: AlertRepository,
): Promise<void> {
  const idempotencyKey = parseIdempotencyKey(request, response);
  if (idempotencyKey === null) return;

  let alert;
  try {
    alert = normalizeAlertIngress(request.body, idempotencyKey);
  } catch (error) {
    if (error instanceof AlertInputValidationError) {
      sendValidationError(response, error.details);
      return;
    }
    next(error);
    return;
  }

  try {
    const result = await repository.ingest(alert, principalSubject(response));
    if (result.kind === 'conflict') {
      response.status(409).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'CONFLICT',
            message: 'Source event identifier conflicts with stored content.',
          },
        }),
      );
      return;
    }
    const body =
      result.kind === 'accepted'
        ? AlertIngestResponseSchema.parse({
            status: 'accepted',
            alert: result.alert,
          })
        : AlertIngestResponseSchema.parse({
            status: 'duplicate',
            alertId: result.alertId,
          });
    response.status(result.kind === 'accepted' ? 201 : 200).json(body);
  } catch (error) {
    next(error);
  }
}

async function ingestBatch(
  request: Request,
  response: Response,
  next: NextFunction,
  repository: AlertRepository,
): Promise<void> {
  const batchIdempotencyKey = parseIdempotencyKey(request, response);
  if (batchIdempotencyKey === null) return;

  const parsedBatch = AlertBatchRequestSchema.safeParse(request.body);
  if (!parsedBatch.success) {
    sendValidationError(
      response,
      parsedBatch.error.issues.slice(0, 100).map((issue) => ({
        path: issue.path.filter(
          (part): part is string | number =>
            typeof part === 'string' || typeof part === 'number',
        ),
        message: issue.message.slice(0, 1000),
      })),
    );
    return;
  }

  const summary: AlertBatchResponse = {
    accepted: 0,
    rejected: 0,
    duplicate: 0,
    failed: 0,
    records: [],
  };
  const actorId = principalSubject(response);

  for (const [index, rawRecord] of parsedBatch.data.records.entries()) {
    let alert;
    try {
      alert = normalizeAlertIngress(
        rawRecord,
        batchIdempotencyKey === undefined
          ? undefined
          : `${batchIdempotencyKey}:${index}`,
      );
    } catch (error) {
      if (!(error instanceof AlertInputValidationError)) {
        summary.failed += 1;
        summary.records.push({
          index,
          status: 'failed',
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Record could not be processed.',
          },
        });
        continue;
      }
      summary.rejected += 1;
      summary.records.push({
        index,
        status: 'rejected',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Alert record did not match the supported import format.',
          details: error.details,
        },
      });
      continue;
    }

    try {
      const result = await repository.ingest(alert, actorId, index);
      if (result.kind === 'accepted') {
        summary.accepted += 1;
        summary.records.push({
          index,
          status: 'accepted',
          alertId: result.alert.id,
        });
      } else if (result.kind === 'duplicate') {
        summary.duplicate += 1;
        summary.records.push({
          index,
          status: 'duplicate',
          alertId: result.alertId,
        });
      } else {
        summary.rejected += 1;
        summary.records.push({
          index,
          status: 'rejected',
          alertId: result.alertId,
          error: {
            code: 'CONFLICT',
            message: 'Source event identifier conflicts with stored content.',
          },
        });
      }
    } catch {
      summary.failed += 1;
      summary.records.push({
        index,
        status: 'failed',
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Record could not be persisted.',
        },
      });
    }
  }

  response.status(200).json(AlertBatchResponseSchema.parse(summary));
}

async function listAlerts(
  request: Request,
  response: Response,
  next: NextFunction,
  repository: AlertRepository,
): Promise<void> {
  const parsed = AlertListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    sendValidationError(
      response,
      parsed.error.issues.slice(0, 100).map((issue) => ({
        path: issue.path.filter(
          (part): part is string | number =>
            typeof part === 'string' || typeof part === 'number',
        ),
        message: issue.message.slice(0, 1000),
      })),
    );
    return;
  }

  if (
    parsed.data.from &&
    parsed.data.to &&
    Date.parse(parsed.data.from) >= Date.parse(parsed.data.to)
  ) {
    sendValidationError(response, [
      { path: ['to'], message: 'The to timestamp must be later than from.' },
    ]);
    return;
  }

  const query = { ...parsed.data };
  if (query.severity) {
    const severity = normalizeSeverity(query.severity);
    if (!severity) {
      sendValidationError(response, [
        { path: ['severity'], message: 'Unsupported severity value.' },
      ]);
      return;
    }
    query.severity = severity;
  }

  try {
    response.json(await repository.list(query));
  } catch (error) {
    next(error);
  }
}

function principalSubject(response: Response): string {
  return (response.locals.principal as AuthenticatedPrincipal).subject;
}

function parseIdempotencyKey(
  request: Request,
  response: Response,
): string | undefined | null {
  const rawKey = request.get('Idempotency-Key');
  if (rawKey === undefined) return undefined;
  const parsed = IdempotencyKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    sendValidationError(response, [
      {
        path: ['headers', 'Idempotency-Key'],
        message: 'Idempotency-Key must contain 1–120 safe characters.',
      },
    ]);
    return null;
  }
  return parsed.data;
}

function sendValidationError(
  response: Response,
  details: { path: (string | number)[]; message: string }[],
): void {
  response.status(400).json(
    ApiErrorResponseSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request did not match the supported alert API format.',
        details: details.slice(0, 100),
      },
    }),
  );
}
