import type { AlertSeverity } from '@cybernexus/shared';
import {
  AlertIngressRecordSchema,
  MAX_ALERT_RECORD_BYTES,
} from './contracts.js';

const severityAliases: Readonly<Record<string, AlertSeverity>> = {
  informational: 'informational',
  info: 'informational',
  low: 'low',
  notice: 'low',
  medium: 'medium',
  moderate: 'medium',
  warning: 'medium',
  warn: 'medium',
  high: 'high',
  error: 'high',
  severe: 'critical',
  fatal: 'critical',
  critical: 'critical',
  unknown: 'unknown',
};

export type NormalizedAlertInput = {
  source: string;
  externalId?: string;
  idempotencyKey?: string;
  alertType?: string;
  title: string;
  severity: AlertSeverity;
  observedAt: Date;
  payload: Record<string, unknown>;
  sourceMetadata: Record<string, unknown>;
  normalizedAttributes?: Record<string, unknown>;
};

export type AlertValidationDetail = {
  path: (string | number)[];
  message: string;
};

export class AlertInputValidationError extends Error {
  constructor(
    readonly details: AlertValidationDetail[],
    message = 'Alert record did not match the supported import format.',
  ) {
    super(message);
    this.name = 'AlertInputValidationError';
  }
}

export function normalizeSeverity(value: string): AlertSeverity | undefined {
  return severityAliases[value.trim().toLowerCase()];
}

export function normalizeAlertIngress(
  raw: unknown,
  idempotencyKey?: string,
): NormalizedAlertInput {
  const serialized = safeSerialize(raw);
  if (serialized === undefined) {
    throw new AlertInputValidationError([
      { path: [], message: 'Record must be valid JSON.' },
    ]);
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ALERT_RECORD_BYTES) {
    throw new AlertInputValidationError(
      [
        {
          path: [],
          message: `Record exceeds the ${MAX_ALERT_RECORD_BYTES}-byte limit.`,
        },
      ],
      `Alert record exceeds the ${MAX_ALERT_RECORD_BYTES}-byte limit.`,
    );
  }

  const parsed = AlertIngressRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AlertInputValidationError(
      parsed.error.issues.slice(0, 100).map((issue) => ({
        path: issue.path.filter(
          (part): part is string | number =>
            typeof part === 'string' || typeof part === 'number',
        ),
        message: issue.message.slice(0, 1000),
      })),
    );
  }

  const severity = normalizeSeverity(parsed.data.severity);
  if (!severity) {
    throw new AlertInputValidationError([
      { path: ['severity'], message: 'Unsupported severity value.' },
    ]);
  }

  const normalizedAttributes = normalizeEntityIdentifiers(parsed.data.payload);
  const originalRecord = raw as Record<string, unknown>;
  const sourceMetadata = {
    schemaVersion: 'alert-ingress-v1',
    ingestionMethod: 'api:v1/alerts',
    inputFields: Object.keys(originalRecord).sort(),
    inputSource: originalRecord.source,
    ...(originalRecord.externalId === undefined
      ? {}
      : { inputExternalId: originalRecord.externalId }),
    ...(originalRecord.alertType === undefined
      ? {}
      : { inputAlertType: originalRecord.alertType }),
    inputTitle: originalRecord.title,
    inputObservedAt: originalRecord.observedAt,
    inputSeverity: originalRecord.severity,
    externalIdProvided: parsed.data.externalId !== undefined,
    idempotencyKeyProvided: idempotencyKey !== undefined,
    entityFieldPaths: normalizedAttributes.fieldPaths,
  };

  return {
    source: parsed.data.source.toLowerCase(),
    ...(parsed.data.externalId !== undefined
      ? { externalId: parsed.data.externalId }
      : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    ...(parsed.data.alertType !== undefined
      ? { alertType: parsed.data.alertType.toLowerCase() }
      : {}),
    title: parsed.data.title,
    severity,
    observedAt: new Date(parsed.data.observedAt),
    payload: parsed.data.payload,
    sourceMetadata,
    ...(Object.keys(normalizedAttributes.values).length
      ? { normalizedAttributes: normalizedAttributes.values }
      : {}),
  };
}

function normalizeEntityIdentifiers(payload: Record<string, unknown>): {
  values: Record<string, string>;
  fieldPaths: Record<string, string>;
} {
  const values: Record<string, string> = {};
  const fieldPaths: Record<string, string> = {};
  const fields: Record<string, readonly string[]> = {
    userId: ['userId', 'user', 'actorId'],
    deviceId: ['deviceId', 'hostId', 'endpointId'],
    cloudResourceId: ['cloudResourceId', 'resourceId', 'resource'],
  };

  for (const [normalizedName, candidates] of Object.entries(fields)) {
    for (const candidate of candidates) {
      const value = payload[candidate];
      if (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.trim().length <= 512
      ) {
        values[normalizedName] = value.trim();
        fieldPaths[normalizedName] = `payload.${candidate}`;
        break;
      }
    }
  }
  return { values, fieldPaths };
}

function safeSerialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
