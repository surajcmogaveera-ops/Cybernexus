import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  type CorrelationEntityType,
  ApiErrorResponseSchema,
  CorrelationStatusSchema,
  IncidentStatusSchema,
} from '@cybernexus/shared';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { toAlertRecord } from '../alerts/repository.js';
import { writeAuditEvent } from '../audit/write-audit-event.js';
import { requireScopes } from '../security/auth.js';
import {
  IncidentDetailResponseSchema,
  IncidentGraphResponseSchema,
  IncidentListQuerySchema,
  IncidentListResponseSchema,
  IncidentRecordSchema,
  IncidentStatusUpdateSchema,
  IncidentTimelineResponseSchema,
  type IncidentTimelineEvent,
} from './contracts.js';

const permittedTransitions: Record<string, readonly string[]> = {
  new: ['triaged'],
  triaged: ['investigating', 'resolved'],
  investigating: ['resolved'],
  resolved: ['investigating', 'closed'],
  closed: [],
};
type Principal = { subject: string };

export function createIncidentRouter(database: PrismaClient): Router {
  const router = Router();
  router.get('/', requireScopes('api:read'), (req, res, next) =>
    listIncidents(req, res, next, database),
  );
  router.get(
    '/:incidentId/timeline',
    requireScopes('api:read'),
    (req, res, next) => getTimeline(req, res, next, database),
  );
  router.get(
    '/:incidentId/graph',
    requireScopes('api:read'),
    (req, res, next) => getGraph(req, res, next, database),
  );
  router.get('/:incidentId', requireScopes('api:read'), (req, res, next) =>
    getIncident(req, res, next, database),
  );
  router.patch(
    '/:incidentId/status',
    requireScopes('api:write'),
    (req, res, next) => updateIncidentStatus(req, res, next, database),
  );
  return router;
}

async function listIncidents(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
): Promise<void> {
  const parsed = IncidentListQuerySchema.safeParse(request.query);
  if (!parsed.success)
    return sendValidationError(response, parsed.error.issues);
  try {
    const where: Prisma.IncidentWhereInput = {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.severity ? { severity: parsed.data.severity } : {}),
    };
    const [rows, totalItems] = await Promise.all([
      database.incident.findMany({
        where,
        include: { alertLinks: { select: { alertId: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (parsed.data.page - 1) * parsed.data.pageSize,
        take: parsed.data.pageSize,
      }),
      database.incident.count({ where }),
    ]);
    response.json(
      IncidentListResponseSchema.parse({
        items: rows.map(toIncidentRecord),
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

async function getIncident(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
): Promise<void> {
  try {
    const incidentId = pathParam(request.params.incidentId);
    if (!incidentId) return sendNotFound(response);
    const incident = await database.incident.findUnique({
      where: { id: incidentId },
      include: { alertLinks: { include: { alert: true } } },
    });
    if (!incident) return sendNotFound(response);
    const ids = incident.alertLinks.map(({ alertId }) => alertId);
    const relationships = await database.alertRelationship.findMany({
      where: { sourceAlertId: { in: ids }, targetAlertId: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    response.json(
      IncidentDetailResponseSchema.parse({
        incident: toIncidentRecord(incident),
        alerts: incident.alertLinks.map(({ alert }) => toAlertRecord(alert)),
        relationships: relationships.map(toRelationshipRecord),
      }),
    );
  } catch (error) {
    next(error);
  }
}

async function getTimeline(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
): Promise<void> {
  try {
    const incidentId = pathParam(request.params.incidentId);
    if (!incidentId) return sendNotFound(response);
    const incident = await database.incident.findUnique({
      where: { id: incidentId },
      include: { alertLinks: { include: { alert: true } } },
    });
    if (!incident) return sendNotFound(response);
    const alertIds = incident.alertLinks.map(({ alertId }) => alertId);
    const relationships = await database.alertRelationship.findMany({
      where: {
        sourceAlertId: { in: alertIds },
        targetAlertId: { in: alertIds },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const relationshipIds = relationships.map(({ id }) => id);
    const auditEvents = await database.auditEvent.findMany({
      where: {
        OR: [
          {
            targetType: 'Incident',
            targetId: incident.id,
            eventType: 'incident.status_changed',
          },
          ...(relationshipIds.length
            ? [
                {
                  targetType: 'AlertRelationship',
                  targetId: { in: relationshipIds },
                  eventType: 'correlation.relationship.status_changed',
                },
              ]
            : []),
        ],
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const items: IncidentTimelineEvent[] = [
      {
        id: incident.id,
        kind: 'incident_created',
        occurredAt: incident.createdAt.toISOString(),
        title: 'Incident created',
      },
      ...incident.alertLinks.map(({ alert }) => ({
        id: alert.id,
        kind: 'alert_observed' as const,
        occurredAt: alert.observedAt.toISOString(),
        title: alert.title,
        details: `Source: ${alert.source}`,
        alertId: alert.id,
        source: alert.source,
        ...(alert.externalId ? { externalId: alert.externalId } : {}),
      })),
      ...relationships.map((relationship) => ({
        id: relationship.id,
        kind: 'relationship_proposed' as const,
        occurredAt: relationship.createdAt.toISOString(),
        title: `Candidate ${relationship.relationshipType.replaceAll('_', ' ')} relationship`,
        details: `${relationship.status}: ${relationship.rationale}`,
        relationshipId: relationship.id,
      })),
    ];
    for (const event of auditEvents) {
      const metadata = asObject(event.metadata);
      if (event.eventType === 'incident.status_changed') {
        const fromStatus = IncidentStatusSchema.safeParse(metadata?.fromStatus);
        const toStatus = IncidentStatusSchema.safeParse(metadata?.toStatus);
        if (!fromStatus.success || !toStatus.success) continue;
        items.push({
          id: event.id,
          kind: 'status_changed',
          occurredAt: event.occurredAt.toISOString(),
          title: 'Incident status changed',
          details: `${fromStatus.data} → ${toStatus.data}`,
          fromStatus: fromStatus.data,
          toStatus: toStatus.data,
        });
        continue;
      }
      const status = CorrelationStatusSchema.safeParse(metadata?.toStatus);
      if (!status.success) continue;
      items.push({
        id: event.id,
        kind: 'relationship_reviewed',
        occurredAt: event.occurredAt.toISOString(),
        title: 'Relationship reviewed',
        details: `Status set to ${status.data}`,
        relationshipId: event.targetId,
      });
    }
    items.sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.id.localeCompare(right.id),
    );
    response.json(
      IncidentTimelineResponseSchema.parse({ incidentId: incident.id, items }),
    );
  } catch (error) {
    next(error);
  }
}

async function getGraph(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
): Promise<void> {
  try {
    const incidentId = pathParam(request.params.incidentId);
    if (!incidentId) return sendNotFound(response);
    const incident = await database.incident.findUnique({
      where: { id: incidentId },
      include: {
        alertLinks: {
          include: {
            alert: { include: { entityLinks: { include: { entity: true } } } },
          },
        },
      },
    });
    if (!incident) return sendNotFound(response);
    const alertIds = incident.alertLinks.map(({ alertId }) => alertId);
    const relationships = await database.alertRelationship.findMany({
      where: {
        sourceAlertId: { in: alertIds },
        targetAlertId: { in: alertIds },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const entityNodes = new Map<
      string,
      {
        type: 'entity';
        id: string;
        label: string;
        entityType: CorrelationEntityType;
      }
    >();
    for (const { alert } of incident.alertLinks) {
      for (const { entity } of alert.entityLinks) {
        entityNodes.set(entity.id, {
          type: 'entity',
          id: entity.id,
          label: entity.value,
          entityType: entity.entityType,
        });
      }
    }
    const nodes = [
      { type: 'incident' as const, id: incident.id, label: incident.title },
      ...incident.alertLinks.map(({ alert }) => ({
        type: 'alert' as const,
        id: alert.id,
        label: alert.title,
      })),
      ...entityNodes.values(),
    ];
    const edges = [
      ...incident.alertLinks.map(({ alertId }) => ({
        id: stableEdgeId(`incident:${incident.id}:${alertId}`),
        sourceId: incident.id,
        targetId: alertId,
        type: 'incident_alert' as const,
      })),
      ...incident.alertLinks.flatMap(({ alertId, alert }) =>
        alert.entityLinks.map(({ entity }) => ({
          id: stableEdgeId(`entity:${alertId}:${entity.id}`),
          sourceId: alertId,
          targetId: entity.id,
          type: 'alert_entity' as const,
        })),
      ),
      ...relationships.map((relationship) => ({
        id: relationship.id,
        sourceId: relationship.sourceAlertId,
        targetId: relationship.targetAlertId,
        type: 'correlation' as const,
        relationshipStatus: relationship.status,
        confidence: relationship.confidence,
        rationale: relationship.rationale,
      })),
    ];
    response.json(
      IncidentGraphResponseSchema.parse({
        incidentId: incident.id,
        nodes,
        edges,
      }),
    );
  } catch (error) {
    next(error);
  }
}

async function updateIncidentStatus(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
): Promise<void> {
  const parsed = IncidentStatusUpdateSchema.safeParse(request.body);
  if (!parsed.success)
    return sendValidationError(response, parsed.error.issues);
  try {
    const incidentId = pathParam(request.params.incidentId);
    if (!incidentId) return sendNotFound(response);
    const incident = await database.$transaction(async (transaction) => {
      const current = await transaction.incident.findUnique({
        where: { id: incidentId },
      });
      if (!current) return null;
      if (!permittedTransitions[current.status]?.includes(parsed.data.status))
        throw new InvalidIncidentTransitionError();
      const now = new Date();
      const updated = await transaction.incident.update({
        where: { id: current.id },
        data: {
          status: parsed.data.status,
          ...(parsed.data.status === 'resolved' ? { resolvedAt: now } : {}),
          ...(parsed.data.status === 'closed' ? { closedAt: now } : {}),
          ...(parsed.data.status === 'investigating'
            ? { resolvedAt: null, closedAt: null }
            : {}),
        },
        include: { alertLinks: { select: { alertId: true } } },
      });
      await writeAuditEvent(transaction, {
        eventType: 'incident.status_changed',
        targetType: 'Incident',
        targetId: current.id,
        actorId: (response.locals.principal as Principal).subject,
        metadata: { fromStatus: current.status, toStatus: updated.status },
      });
      return updated;
    });
    if (!incident) return sendNotFound(response);
    response.json({ incident: toIncidentRecord(incident) });
  } catch (error) {
    if (error instanceof InvalidIncidentTransitionError) {
      response.status(409).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'CONFLICT',
            message: 'The requested incident status transition is not allowed.',
          },
        }),
      );
      return;
    }
    next(error);
  }
}

export class InvalidIncidentTransitionError extends Error {}

export function toIncidentRecord(incident: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  needsHumanReview: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  alertLinks: { alertId: string }[];
}) {
  return IncidentRecordSchema.parse({
    id: incident.id,
    title: incident.title,
    ...(incident.description === null
      ? {}
      : { description: incident.description }),
    status: incident.status,
    severity: incident.severity,
    ...(incident.needsHumanReview === null
      ? {}
      : { needsHumanReview: incident.needsHumanReview }),
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    alertIds: incident.alertLinks.map(({ alertId }) => alertId).sort(),
  });
}

export function toRelationshipRecord(row: {
  id: string;
  sourceAlertId: string;
  targetAlertId: string;
  relationshipType: string;
  confidence: number;
  rationale: string;
  evidence: Prisma.JsonValue;
  status: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    sourceAlertId: row.sourceAlertId,
    targetAlertId: row.targetAlertId,
    relationshipType: row.relationshipType,
    confidence: row.confidence,
    rationale: row.rationale,
    evidence: row.evidence,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function sendValidationError(
  response: Response,
  issues: { path: PropertyKey[]; message: string }[],
): void {
  response.status(400).json(
    ApiErrorResponseSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request did not match the supported incident API format.',
        details: issues.slice(0, 100).map(({ path, message }) => ({
          path: path.filter(
            (part): part is string | number =>
              typeof part === 'string' || typeof part === 'number',
          ),
          message: message.slice(0, 1000),
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
        message: 'The requested incident was not found.',
      },
    }),
  );
}

function stableEdgeId(value: string): string {
  const hex = createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const raw = hex.join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function asObject(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pathParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
