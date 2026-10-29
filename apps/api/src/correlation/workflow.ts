import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  CorrelationRequestSchema,
  CorrelationResultSchema,
  type CorrelationAlertInput,
  type CorrelationCandidate,
  type CorrelationEntity,
  type CorrelationEntityType,
} from '@cybernexus/shared';
import { writeAuditEvent } from '../audit/write-audit-event.js';
import type { CorrelationService } from './service-client.js';
import {
  CorrelationRunResponseSchema,
  type CorrelationRunResponse,
} from './contracts.js';

const STRONG_ENTITY_TYPES = new Set<CorrelationEntityType>([
  'user',
  'device',
  'cloud_resource',
]);
const RELATIONSHIP_ENTITY_TYPE: Record<string, CorrelationEntityType> = {
  shared_user: 'user',
  shared_device: 'device',
  shared_cloud_resource: 'cloud_resource',
  shared_ip: 'ip',
};

export class CorrelationInputNotFoundError extends Error {}
export class InvalidCorrelationServiceResponseError extends Error {}

type JsonObject = { [key: string]: Prisma.JsonValue };
type AlertRow = {
  id: string;
  source: string;
  externalId: string | null;
  alertType: string | null;
  title: string;
  severity:
    'informational' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  observedAt: Date;
  ingestedAt: Date;
  payload: Prisma.JsonValue;
  normalizedAttributes: Prisma.JsonValue | null;
};

export async function runCorrelationWorkflow(
  database: PrismaClient,
  service: CorrelationService,
  alertIds: string[],
  actorId: string,
): Promise<CorrelationRunResponse> {
  const orderedIds = [...alertIds].sort();
  const alertRows = (await database.securityAlert.findMany({
    where: { id: { in: orderedIds } },
  })) as AlertRow[];
  if (alertRows.length !== orderedIds.length) {
    throw new CorrelationInputNotFoundError();
  }
  const alertsById = new Map(alertRows.map((alert) => [alert.id, alert]));
  const correlationAlerts = alertRows
    .map(toCorrelationAlert)
    .sort((left, right) => left.id.localeCompare(right.id));
  const request = CorrelationRequestSchema.parse({
    contractVersion: 'v1',
    requestId: randomUUID(),
    alerts: correlationAlerts,
  });
  const rawResult = await service.correlate(request);
  const result = CorrelationResultSchema.parse(rawResult);
  if (result.requestId !== request.requestId) {
    throw new InvalidCorrelationServiceResponseError();
  }
  validateServiceEvidence(request.alerts, result.relationships);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await database.$transaction(async (transaction) => {
        await persistEntities(transaction, request.alerts, alertsById);

        const existingLinks = await transaction.incidentAlert.findMany({
          where: { alertId: { in: orderedIds } },
          select: { alertId: true },
        });
        const alreadyIncidentLinked = new Set(
          existingLinks.map(({ alertId }) => alertId),
        );
        const candidates = result.relationships.map((candidate) => {
          if (
            candidate.status === 'proposed' &&
            (alreadyIncidentLinked.has(candidate.sourceAlertId) ||
              alreadyIncidentLinked.has(candidate.targetAlertId))
          ) {
            return { ...candidate, status: 'review_required' as const };
          }
          return candidate;
        });

        const relationships = [];
        for (const candidate of candidates) {
          const correlationKey = relationshipKey(candidate);
          let row = await transaction.alertRelationship.findUnique({
            where: { correlationKey },
          });
          if (!row) {
            row = await transaction.alertRelationship.create({
              data: {
                id: randomUUID(),
                correlationKey,
                sourceAlertId: candidate.sourceAlertId,
                targetAlertId: candidate.targetAlertId,
                relationshipType: candidate.relationshipType,
                confidence: candidate.confidence,
                rationale: candidate.rationale,
                evidence:
                  candidate.evidence as unknown as Prisma.InputJsonArray,
                status: candidate.status,
                correlationVersion: 'v1',
              },
            });
            await writeAuditEvent(transaction, {
              eventType:
                candidate.status === 'review_required'
                  ? 'correlation.relationship_review_required'
                  : 'correlation.relationship_proposed',
              targetType: 'AlertRelationship',
              targetId: row.id,
              actorId,
              metadata: {
                correlationVersion: 'v1',
                relationshipType: candidate.relationshipType,
                confidence: candidate.confidence,
                sourceAlertId: candidate.sourceAlertId,
                targetAlertId: candidate.targetAlertId,
                evidenceCount: candidate.evidence.length,
              },
            });
          }
          relationships.push(toPersistedRelationship(row));
        }

        const incidentComponents = relationshipComponents(
          relationships.filter(
            ({ status, confidence }) =>
              (status === 'proposed' || status === 'accepted') &&
              confidence >= 0.85,
          ),
        );
        const incidents = [];
        for (const component of incidentComponents) {
          const componentAlerts = component
            .map((id) => alertsById.get(id))
            .filter((alert): alert is AlertRow => alert !== undefined);
          if (componentAlerts.length < 2) continue;
          const correlationKey = incidentKey(component);
          let incident = await transaction.incident.findUnique({
            where: { correlationKey },
            include: { alertLinks: true },
          });
          if (component.some((id) => alreadyIncidentLinked.has(id))) {
            const existingAlertIds = incident?.alertLinks
              .map(({ alertId }) => alertId)
              .sort();
            if (
              incident &&
              existingAlertIds?.length === component.length &&
              existingAlertIds.every((id, index) => id === component[index]) &&
              component.every((id) => alreadyIncidentLinked.has(id))
            ) {
              incidents.push(toIncidentSummary(incident));
            }
            continue;
          }
          if (!incident) {
            const severity = highestSeverity(componentAlerts);
            incident = await transaction.incident.create({
              data: {
                id: randomUUID(),
                correlationKey,
                title: `Correlated activity across ${componentAlerts.length} alerts`,
                description:
                  'Candidate group generated from direct entity matches. Relationship explanations remain hypotheses and require analyst review; no attack is confirmed.',
                status: 'new',
                severity,
                needsHumanReview: true,
                alertLinks: {
                  create: component.map((alertId) => ({ alertId })),
                },
              },
              include: { alertLinks: true },
            });
            await writeAuditEvent(transaction, {
              eventType: 'incident.created',
              targetType: 'Incident',
              targetId: incident.id,
              actorId,
              metadata: {
                correlationVersion: 'v1',
                alertCount: componentAlerts.length,
                relationshipCount: relationships.filter(
                  (relationship) =>
                    component.includes(relationship.sourceAlertId) &&
                    component.includes(relationship.targetAlertId),
                ).length,
                needsHumanReview: true,
              },
            });
          }
          incidents.push(toIncidentSummary(incident));
        }

        const alertsRequiringReview = new Set<string>();
        for (const relationship of relationships) {
          if (relationship.status === 'review_required') {
            alertsRequiringReview.add(relationship.sourceAlertId);
            alertsRequiringReview.add(relationship.targetAlertId);
          }
        }
        await writeAuditEvent(transaction, {
          eventType: 'correlation.run.completed',
          targetType: 'CorrelationRun',
          targetId: request.requestId,
          actorId,
          metadata: {
            correlationVersion: 'v1',
            processedAlertCount: alertRows.length,
            candidateRelationshipCount: relationships.length,
            incidentCount: incidents.length,
            alertsRequiringReview: alertsRequiringReview.size,
          },
        });

        return CorrelationRunResponseSchema.parse({
          requestId: request.requestId,
          processedAlertCount: alertRows.length,
          candidateRelationshipCount: relationships.length,
          relationships,
          incidents,
          alertsRequiringReview: [...alertsRequiringReview].sort(),
        });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 1) throw error;
      // Another run won a uniqueness race. Retry the entire transaction; existing
      // relationship and incident decisions are read without being overwritten.
    }
  }
  throw new Error('Correlation persistence could not be completed.');
}

export function validateServiceEvidence(
  alerts: CorrelationAlertInput[],
  candidates: CorrelationCandidate[],
): void {
  const alertById = new Map(alerts.map((alert) => [alert.id, alert]));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (
      candidate.sourceAlertId >= candidate.targetAlertId ||
      !alertById.has(candidate.sourceAlertId) ||
      !alertById.has(candidate.targetAlertId) ||
      candidate.status === 'accepted' ||
      candidate.status === 'rejected'
    ) {
      throw new InvalidCorrelationServiceResponseError();
    }
    const key = `${candidate.sourceAlertId}|${candidate.targetAlertId}|${candidate.relationshipType}`;
    if (seen.has(key)) throw new InvalidCorrelationServiceResponseError();
    seen.add(key);

    const expectedEntityType =
      RELATIONSHIP_ENTITY_TYPE[candidate.relationshipType];
    if (
      !candidate.evidence.some(
        (evidence) => evidence.entityType === expectedEntityType,
      )
    ) {
      throw new InvalidCorrelationServiceResponseError();
    }

    for (const evidence of candidate.evidence) {
      const sourceValue = evidenceValue(
        alertById.get(candidate.sourceAlertId)!,
        evidence.sourceField,
        evidence.entityType,
      );
      const targetValue = evidenceValue(
        alertById.get(candidate.targetAlertId)!,
        evidence.targetField,
        evidence.entityType,
      );
      if (!sourceValue || sourceValue !== targetValue) {
        throw new InvalidCorrelationServiceResponseError();
      }
    }

    const source = alertById.get(candidate.sourceAlertId)!;
    const target = alertById.get(candidate.targetAlertId)!;
    if (
      Math.abs(Date.parse(source.observedAt) - Date.parse(target.observedAt)) >
      2 * 60 * 60 * 1000
    ) {
      throw new InvalidCorrelationServiceResponseError();
    }

    const strongEvidenceTypes = new Set(
      candidate.evidence
        .map(({ entityType }) => entityType)
        .filter((type) => STRONG_ENTITY_TYPES.has(type)),
    );
    const conflict = [...STRONG_ENTITY_TYPES].some((type) => {
      const sourceValues = source.entities
        .filter((entity) => entity.entityType === type)
        .map(({ value }) => canonicalEntityValue(value));
      const targetValues = target.entities
        .filter((entity) => entity.entityType === type)
        .map(({ value }) => canonicalEntityValue(value));
      return (
        sourceValues.length > 0 &&
        targetValues.length > 0 &&
        !sourceValues.some((value) => targetValues.includes(value))
      );
    });
    const repeatedSamePipeline =
      candidate.relationshipType === 'shared_device' &&
      strongEvidenceTypes.size === 1 &&
      source.source.toLowerCase() === target.source.toLowerCase() &&
      (source.alertType ?? '').toLowerCase() ===
        (target.alertType ?? '').toLowerCase();
    const expectedStatus =
      candidate.relationshipType === 'shared_ip' ||
      conflict ||
      repeatedSamePipeline
        ? 'review_required'
        : 'proposed';
    const baseStrength: Record<string, number> = {
      shared_user: 0.9,
      shared_device: 0.92,
      shared_cloud_resource: 0.9,
      shared_ip: 0.45,
    };
    const rawStrength =
      baseStrength[candidate.relationshipType]! +
      (strongEvidenceTypes.size > 1 ? 0.03 : 0);
    const expectedStrength =
      conflict || repeatedSamePipeline
        ? Math.min(0.74, rawStrength)
        : Math.min(0.98, rawStrength);
    if (
      candidate.status !== expectedStatus ||
      candidate.confidence !== expectedStrength
    ) {
      throw new InvalidCorrelationServiceResponseError();
    }
  }
}

function toCorrelationAlert(alert: AlertRow): CorrelationAlertInput {
  const entities: CorrelationEntity[] = [];
  const attributes = asJsonObject(alert.normalizedAttributes);
  const normalizedFields: [CorrelationEntityType, string][] = [
    ['user', 'userId'],
    ['device', 'deviceId'],
    ['cloud_resource', 'cloudResourceId'],
  ];
  for (const [entityType, field] of normalizedFields) {
    const value = attributes?.[field];
    if (typeof value === 'string' && value.trim() && value.length <= 512) {
      entities.push({
        entityType,
        value: value.trim(),
        fieldPath: `normalizedAttributes.${field}`,
      });
    }
  }
  const payload = asJsonObject(alert.payload);
  for (const field of ['sourceIp', 'destinationIp', 'remoteIp', 'ipAddress']) {
    const value = payload?.[field];
    if (typeof value === 'string' && isIP(value.trim())) {
      entities.push({
        entityType: 'ip',
        value: value.trim(),
        fieldPath: `payload.${field}`,
      });
    }
  }
  const uniqueEntities = entities.filter(
    (entity, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.entityType === entity.entityType &&
          candidate.fieldPath === entity.fieldPath &&
          canonicalEntityValue(candidate.value) ===
            canonicalEntityValue(entity.value),
      ) === index,
  );
  return {
    id: alert.id,
    source: alert.source,
    ...(alert.alertType === null ? {} : { alertType: alert.alertType }),
    observedAt: alert.observedAt.toISOString(),
    entities: uniqueEntities.slice(0, 8),
  };
}

async function persistEntities(
  transaction: Prisma.TransactionClient,
  alerts: CorrelationAlertInput[],
  alertRows: Map<string, AlertRow>,
): Promise<void> {
  const links: {
    alertId: string;
    entityId: string;
    fieldPath: string;
    observedAt: Date;
  }[] = [];
  for (const alert of alerts) {
    for (const entity of alert.entities) {
      const value = canonicalEntityValue(entity.value);
      const row = await transaction.entity.upsert({
        where: { entityType_value: { entityType: entity.entityType, value } },
        create: { id: randomUUID(), entityType: entity.entityType, value },
        update: {},
      });
      const sourceAlert = alertRows.get(alert.id);
      if (!sourceAlert) throw new CorrelationInputNotFoundError();
      links.push({
        alertId: alert.id,
        entityId: row.id,
        fieldPath: entity.fieldPath,
        observedAt: sourceAlert.observedAt,
      });
    }
  }
  if (links.length) {
    await transaction.alertEntity.createMany({
      data: links,
      skipDuplicates: true,
    });
  }
}

function evidenceValue(
  alert: CorrelationAlertInput,
  fieldPath: string,
  entityType: CorrelationEntityType,
): string | undefined {
  const entity = alert.entities.find(
    (candidate) =>
      candidate.entityType === entityType && candidate.fieldPath === fieldPath,
  );
  return entity ? canonicalEntityValue(entity.value) : undefined;
}

function relationshipKey(candidate: CorrelationCandidate): string {
  return createHash('sha256')
    .update(
      `correlation:v1:${candidate.sourceAlertId}:${candidate.targetAlertId}:${candidate.relationshipType}`,
    )
    .digest('hex');
}

function incidentKey(alertIds: string[]): string {
  return createHash('sha256')
    .update(`incident:correlation:v1:${[...alertIds].sort().join(':')}`)
    .digest('hex');
}

function relationshipComponents(
  relationships: { sourceAlertId: string; targetAlertId: string }[],
): string[][] {
  const graph = new Map<string, Set<string>>();
  for (const { sourceAlertId, targetAlertId } of relationships) {
    if (!graph.has(sourceAlertId)) graph.set(sourceAlertId, new Set());
    if (!graph.has(targetAlertId)) graph.set(targetAlertId, new Set());
    graph.get(sourceAlertId)!.add(targetAlertId);
    graph.get(targetAlertId)!.add(sourceAlertId);
  }
  const components: string[][] = [];
  const visited = new Set<string>();
  for (const root of [...graph.keys()].sort()) {
    if (visited.has(root)) continue;
    const component: string[] = [];
    const pending = [root];
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      pending.push(
        ...[...(graph.get(current) ?? [])].filter((id) => !visited.has(id)),
      );
    }
    components.push(component.sort());
  }
  return components;
}

function highestSeverity(alerts: AlertRow[]): AlertRow['severity'] {
  const rank = {
    unknown: -1,
    informational: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return alerts.reduce(
    (highest, alert) =>
      rank[alert.severity] > rank[highest] ? alert.severity : highest,
    'unknown' as AlertRow['severity'],
  );
}

function toPersistedRelationship(row: {
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

function toIncidentSummary(incident: {
  id: string;
  title: string;
  status: string;
  severity: string;
  needsHumanReview: boolean | null;
  alertLinks: { alertId: string }[];
}) {
  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    severity: incident.severity,
    needsHumanReview: incident.needsHumanReview === true,
    alertIds: incident.alertLinks.map(({ alertId }) => alertId).sort(),
  };
}

function canonicalEntityValue(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function asJsonObject(value: Prisma.JsonValue | null): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
