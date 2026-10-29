import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ApiErrorResponseSchema,
  IncidentAuditHistoryResponseSchema,
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
  EmptyPrioritizationRequestSchema,
  IncidentAuditQuerySchema,
  IncidentPriorityOverrideRequestSchema,
} from './contracts.js';
import {
  calculateAndPersistPriority,
  getCurrentBreachRisk,
  getCurrentSla,
  getLatestPriority,
  generateAndAuditResponsePlan,
  overrideIncidentPriority,
  PriorityCalculationNotFoundError,
  PriorityIncidentNotFoundError,
  PriorityOverrideConflictError,
} from './service.js';

type Principal = { subject: string };

export function createPrioritizationRouter(database: PrismaClient): Router {
  const router = Router();
  router.post(
    '/:incidentId/priority/recalculate',
    requireScopes('api:write'),
    (req, res, next) => recalculate(req, res, next, database),
  );
  router.get(
    '/:incidentId/priority',
    requireScopes('api:read'),
    (req, res, next) => getPriority(req, res, next, database),
  );
  router.post(
    '/:incidentId/priority/override',
    requireScopes('api:write'),
    (req, res, next) => overridePriority(req, res, next, database),
  );
  router.get('/:incidentId/sla', requireScopes('api:read'), (req, res, next) =>
    getSla(req, res, next, database),
  );
  router.get(
    '/:incidentId/breach-risk',
    requireScopes('api:read'),
    (req, res, next) => getBreachRisk(req, res, next, database),
  );
  router.post(
    '/:incidentId/response-plan',
    requireScopes('api:write'),
    (req, res, next) => getResponsePlan(req, res, next, database),
  );
  router.get(
    '/:incidentId/audit',
    requireScopes('audit:read'),
    (req, res, next) => getAuditHistory(req, res, next, database),
  );
  return router;
}

async function recalculate(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
) {
  if (!validateEmptyBody(request, response)) return;
  const incidentId = validIncidentId(request, response);
  if (!incidentId) return;
  try {
    const priority = await calculateAndPersistPriority(
      database,
      incidentId,
      (response.locals.principal as Principal).subject,
    );
    response.status(201).json({ priority });
  } catch (error) {
    handlePriorityError(error, response, next);
  }
}

async function getPriority(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
) {
  const incidentId = validIncidentId(request, response);
  if (!incidentId) return;
  try {
    response.json({ priority: await getLatestPriority(database, incidentId) });
  } catch (error) {
    handlePriorityError(error, response, next);
  }
}

async function overridePriority(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
) {
  const incidentId = validIncidentId(request, response);
  if (!incidentId) return;
  const parsed = IncidentPriorityOverrideRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    sendValidation(response, parsed.error.issues);
    return;
  }
  try {
    const result = await overrideIncidentPriority(
      database,
      incidentId,
      (response.locals.principal as Principal).subject,
      parsed.data.priority,
      parsed.data.reason,
    );
    response.json({ override: result });
  } catch (error) {
    handlePriorityError(error, response, next);
  }
}

async function getSla(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
) {
  const incidentId = validIncidentId(request, response);
  if (!incidentId) return;
  try {
    response.json({ sla: await getCurrentSla(database, incidentId) });
  } catch (error) {
    handlePriorityError(error, response, next);
  }
}

async function getBreachRisk(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
) {
  const incidentId = validIncidentId(request, response);
  if (!incidentId) return;
  try {
    response.json({
      breachRisk: await getCurrentBreachRisk(database, incidentId),
    });
  } catch (error) {
    handlePriorityError(error, response, next);
  }
}

async function getResponsePlan(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
) {
  if (!validateEmptyBody(request, response)) return;
  const incidentId = validIncidentId(request, response);
  if (!incidentId) return;
  try {
    response.json({
      responsePlan: await generateAndAuditResponsePlan(
        database,
        incidentId,
        (response.locals.principal as Principal).subject,
      ),
    });
  } catch (error) {
    handlePriorityError(error, response, next);
  }
}

async function getAuditHistory(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
) {
  const incidentId = validIncidentId(request, response);
  if (!incidentId) return;
  const parsed = IncidentAuditQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    sendValidation(response, parsed.error.issues);
    return;
  }
  try {
    const incident = await database.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        alertLinks: { select: { alertId: true } },
        analyses: {
          select: { id: true },
          take: 100,
          orderBy: { requestedAt: 'desc' },
        },
      },
    });
    if (!incident) {
      sendNotFound(response);
      return;
    }
    const alertIds = incident.alertLinks.map(({ alertId }) => alertId);
    const relationships = alertIds.length
      ? await database.alertRelationship.findMany({
          where: {
            sourceAlertId: { in: alertIds },
            targetAlertId: { in: alertIds },
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: 800,
        })
      : [];
    const targets: Prisma.AuditEventWhereInput[] = [
      { targetType: 'Incident', targetId: incidentId },
      ...(alertIds.length
        ? [{ targetType: 'SecurityAlert', targetId: { in: alertIds } }]
        : []),
      ...(relationships.length
        ? [
            {
              targetType: 'AlertRelationship',
              targetId: { in: relationships.map(({ id }) => id) },
            },
          ]
        : []),
      ...(incident.analyses.length
        ? [
            {
              targetType: 'AnalysisRun',
              targetId: { in: incident.analyses.map(({ id }) => id) },
            },
          ]
        : []),
    ];
    const where: Prisma.AuditEventWhereInput = { OR: targets };
    const [events, totalItems] = await Promise.all([
      database.auditEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (parsed.data.page - 1) * parsed.data.pageSize,
        take: parsed.data.pageSize,
      }),
      database.auditEvent.count({ where }),
    ]);
    response.json(
      IncidentAuditHistoryResponseSchema.parse({
        incidentId,
        items: events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          targetType: event.targetType,
          targetId: event.targetId,
          actorId: event.actorId,
          occurredAt: event.occurredAt.toISOString(),
          metadata: safeAuditMetadata(event.metadata),
        })),
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        hasNext: parsed.data.page * parsed.data.pageSize < totalItems,
        totalItems,
      }),
    );
  } catch (error) {
    next(error);
  }
}

function safeAuditMetadata(
  value: unknown,
): Record<string, string | number | boolean | null> {
  const allowed = new Set([
    'action',
    'alertCount',
    'approvalStatus',
    'analysisMethod',
    'calculationId',
    'candidateRelationshipCount',
    'evidenceReferences',
    'findingCount',
    'failureClass',
    'fromPriority',
    'fromStatus',
    'incidentCount',
    'incidentId',
    'needsHumanReview',
    'outcome',
    'performed',
    'planVersion',
    'rationale',
    'stepOrder',
    'status',
    'policyVersion',
    'reason',
    'recommendedPriority',
    'relationshipCount',
    'riskScore',
    'slaState',
    'source',
    'sourceEventIdPresent',
    'toPriority',
    'toStatus',
    'validationStatus',
  ]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (
      item === null ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    )
      safe[key] = item;
    else if (typeof item === 'string') safe[key] = item.slice(0, 1000);
  }
  return safe;
}

function validIncidentId(
  request: Request,
  response: Response,
): string | undefined {
  const id =
    typeof request.params.incidentId === 'string'
      ? request.params.incidentId
      : '';
  if (IdentifierSchema.safeParse(id).success) return id;
  sendNotFound(response);
  return undefined;
}

function validateEmptyBody(request: Request, response: Response): boolean {
  const parsed = EmptyPrioritizationRequestSchema.safeParse(request.body ?? {});
  if (parsed.success) return true;
  sendValidation(response, parsed.error.issues);
  return false;
}

function handlePriorityError(
  error: unknown,
  response: Response,
  next: NextFunction,
): void {
  if (
    error instanceof PriorityIncidentNotFoundError ||
    error instanceof PriorityCalculationNotFoundError
  ) {
    sendNotFound(response);
    return;
  }
  if (error instanceof PriorityOverrideConflictError) {
    response.status(409).json(
      ApiErrorResponseSchema.parse({
        error: {
          code: 'CONFLICT',
          message:
            'The priority override was already set or the incident changed concurrently.',
        },
      }),
    );
    return;
  }
  next(error);
}

function sendValidation(
  response: Response,
  issues: { path: PropertyKey[]; message: string }[],
): void {
  response.status(400).json(
    ApiErrorResponseSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message:
          'Request did not match the supported prioritization API format.',
        details: issues.slice(0, 50).map(({ path, message }) => ({
          path: path.filter(
            (part): part is string | number =>
              typeof part === 'string' || typeof part === 'number',
          ),
          message: message.slice(0, 500),
        })),
      },
    }),
  );
}

function sendNotFound(response: Response): void {
  response.status(404).json(
    ApiErrorResponseSchema.parse({
      error: {
        code: 'NOT_FOUND',
        message:
          'The requested incident or priority calculation was not found.',
      },
    }),
  );
}
