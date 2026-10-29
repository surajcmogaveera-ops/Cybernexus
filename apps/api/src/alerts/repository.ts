import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AlertSeveritySchema } from '@cybernexus/shared';
import { writeAuditEvent } from '../audit/write-audit-event.js';
import {
  AlertListResponseSchema,
  AlertRecordSchema,
  type AlertListQuery,
  type AlertRecord,
} from './contracts.js';
import type { NormalizedAlertInput } from './normalization.js';

export type AlertIngestOutcome =
  | { kind: 'accepted'; alert: AlertRecord }
  | { kind: 'duplicate'; alertId: string }
  | { kind: 'conflict'; alertId: string };

export type AlertRepository = {
  ingest(
    alert: NormalizedAlertInput,
    actorId: string,
    recordIndex?: number,
  ): Promise<AlertIngestOutcome>;
  list(
    query: AlertListQuery,
  ): Promise<ReturnType<typeof AlertListResponseSchema.parse>>;
};

export function createPrismaAlertRepository(
  database: PrismaClient,
): AlertRepository {
  const findBySourceEventId = (source: string, externalId: string) =>
    database.securityAlert.findUnique({
      where: { source_externalId: { source, externalId } },
    });
  const findByIdempotencyKey = (source: string, idempotencyKey: string) =>
    database.securityAlert.findUnique({
      where: { source_idempotencyKey: { source, idempotencyKey } },
    });

  return {
    async ingest(alert, actorId, recordIndex) {
      try {
        return await database.$transaction(async (transaction) => {
          const existingByEventId =
            alert.externalId === undefined
              ? null
              : await transaction.securityAlert.findUnique({
                  where: {
                    source_externalId: {
                      source: alert.source,
                      externalId: alert.externalId,
                    },
                  },
                });
          const existingByIdempotencyKey =
            existingByEventId || alert.idempotencyKey === undefined
              ? null
              : await transaction.securityAlert.findUnique({
                  where: {
                    source_idempotencyKey: {
                      source: alert.source,
                      idempotencyKey: alert.idempotencyKey,
                    },
                  },
                });
          const existing = existingByEventId ?? existingByIdempotencyKey;

          if (existing) {
            const isExactRetry = matchesNormalizedEvent(existing, alert);
            await writeAuditEvent(transaction, {
              eventType: isExactRetry
                ? 'alert.ingest.duplicate'
                : 'alert.ingest.conflict',
              targetType: 'SecurityAlert',
              targetId: existing.id,
              actorId,
              metadata: {
                source: alert.source,
                sourceEventIdPresent: alert.externalId !== undefined,
                idempotencyKeyUsed: alert.idempotencyKey !== undefined,
                outcome: isExactRetry ? 'duplicate' : 'conflict',
                ...(recordIndex === undefined ? {} : { recordIndex }),
              },
            });
            return isExactRetry
              ? { kind: 'duplicate', alertId: existing.id }
              : { kind: 'conflict', alertId: existing.id };
          }

          const created = await transaction.securityAlert.create({
            data: {
              id: randomUUID(),
              source: alert.source,
              externalId: alert.externalId ?? null,
              idempotencyKey: alert.idempotencyKey ?? null,
              alertType: alert.alertType ?? null,
              title: alert.title,
              severity: alert.severity,
              observedAt: alert.observedAt,
              payload: alert.payload as Prisma.InputJsonObject,
              sourceMetadata: alert.sourceMetadata as Prisma.InputJsonObject,
              ...(alert.normalizedAttributes
                ? {
                    normalizedAttributes:
                      alert.normalizedAttributes as Prisma.InputJsonObject,
                  }
                : {}),
            },
          });

          await writeAuditEvent(transaction, {
            eventType: 'alert.ingest.accepted',
            targetType: 'SecurityAlert',
            targetId: created.id,
            actorId,
            metadata: {
              source: alert.source,
              sourceEventIdPresent: alert.externalId !== undefined,
              idempotencyKeyUsed: alert.idempotencyKey !== undefined,
              ...(recordIndex === undefined ? {} : { recordIndex }),
            },
          });

          return { kind: 'accepted', alert: toAlertRecord(created) };
        });
      } catch (error) {
        if (
          (alert.externalId === undefined &&
            alert.idempotencyKey === undefined) ||
          !isUniqueConstraintError(error)
        ) {
          throw error;
        }

        // A concurrent request may have committed after the initial lookup.
        const existingByEventId =
          alert.externalId === undefined
            ? null
            : await findBySourceEventId(alert.source, alert.externalId);
        const existingByIdempotencyKey =
          existingByEventId || alert.idempotencyKey === undefined
            ? null
            : await findByIdempotencyKey(alert.source, alert.idempotencyKey);
        const existing = existingByEventId ?? existingByIdempotencyKey;
        if (!existing) throw error;
        const isExactRetry = matchesNormalizedEvent(existing, alert);
        await database.$transaction((transaction) =>
          writeAuditEvent(transaction, {
            eventType: isExactRetry
              ? 'alert.ingest.duplicate'
              : 'alert.ingest.conflict',
            targetType: 'SecurityAlert',
            targetId: existing.id,
            actorId,
            metadata: {
              source: alert.source,
              sourceEventIdPresent: alert.externalId !== undefined,
              idempotencyKeyUsed: alert.idempotencyKey !== undefined,
              outcome: isExactRetry ? 'duplicate' : 'conflict',
              concurrentRequest: true,
              ...(recordIndex === undefined ? {} : { recordIndex }),
            },
          }),
        );
        return isExactRetry
          ? { kind: 'duplicate', alertId: existing.id }
          : { kind: 'conflict', alertId: existing.id };
      }
    },

    async list(query) {
      const where: Prisma.SecurityAlertWhereInput = {};
      if (query.source) where.source = query.source.toLowerCase();
      if (query.severity) {
        const severity = AlertSeveritySchema.parse(query.severity);
        where.severity = severity;
      }
      if (query.alertType) where.alertType = query.alertType.toLowerCase();
      if (query.from || query.to) {
        where.observedAt = {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lt: new Date(query.to) } : {}),
        };
      }
      if (query.q) {
        where.OR = [
          { title: { contains: query.q, mode: 'insensitive' } },
          { source: { contains: query.q, mode: 'insensitive' } },
          { externalId: { contains: query.q, mode: 'insensitive' } },
        ];
      }

      const [rows, totalItems] = await Promise.all([
        database.securityAlert.findMany({
          where,
          orderBy: [{ observedAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        database.securityAlert.count({ where }),
      ]);
      return AlertListResponseSchema.parse({
        items: rows.map(toAlertRecord),
        page: query.page,
        pageSize: query.pageSize,
        hasNext: query.page * query.pageSize < totalItems,
        totalItems,
      });
    },
  };
}

export function toAlertRecord(
  row: Prisma.SecurityAlertGetPayload<Record<string, never>>,
): AlertRecord {
  return AlertRecordSchema.parse({
    id: row.id,
    source: row.source,
    ...(row.externalId === null ? {} : { externalId: row.externalId }),
    ...(row.alertType === null ? {} : { alertType: row.alertType }),
    title: row.title,
    severity: row.severity,
    observedAt: row.observedAt.toISOString(),
    ingestedAt: row.ingestedAt.toISOString(),
    payload: row.payload,
    ...(isJsonObject(row.sourceMetadata)
      ? { sourceMetadata: row.sourceMetadata }
      : {}),
    ...(isJsonObject(row.normalizedAttributes)
      ? { normalizedAttributes: row.normalizedAttributes }
      : {}),
  });
}

function matchesNormalizedEvent(
  existing: Prisma.SecurityAlertGetPayload<Record<string, never>>,
  incoming: NormalizedAlertInput,
): boolean {
  return (
    existing.source === incoming.source &&
    (existing.externalId ?? undefined) === incoming.externalId &&
    (existing.alertType ?? undefined) === incoming.alertType &&
    existing.title === incoming.title &&
    existing.severity === incoming.severity &&
    existing.observedAt.getTime() === incoming.observedAt.getTime() &&
    stableJson(existing.payload) === stableJson(incoming.payload) &&
    stableJson(existing.normalizedAttributes) ===
      stableJson(incoming.normalizedAttributes ?? null)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
