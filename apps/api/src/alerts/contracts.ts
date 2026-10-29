import { z } from 'zod';
import {
  AlertSeveritySchema,
  IdentifierSchema,
  UtcTimestampSchema,
} from '@cybernexus/shared';

export const MAX_ALERT_RECORD_BYTES = 32_768;
export const MAX_ALERT_BATCH_RECORDS = 50;
export const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._~-]+$/);

export const AlertIngressRecordSchema = z
  .object({
    source: z.string().trim().min(1).max(120),
    externalId: z.string().trim().min(1).max(200).optional(),
    alertType: z.string().trim().min(1).max(120).optional(),
    observedAt: z.iso.datetime({ offset: true, local: false }),
    title: z.string().trim().min(1).max(500),
    severity: z.string().trim().min(1).max(40),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AlertIngressRecord = z.infer<typeof AlertIngressRecordSchema>;

export const AlertBatchRequestSchema = z
  .object({
    records: z.array(z.unknown()).min(1).max(MAX_ALERT_BATCH_RECORDS),
  })
  .strict();

export const AlertListQuerySchema = z
  .object({
    page: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .default('1')
      .transform(Number)
      .pipe(z.number().int().min(1).max(2_147_483_647)),
    pageSize: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .default('25')
      .transform(Number)
      .pipe(z.number().int().min(1).max(100)),
    source: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .transform((value) => value.toLowerCase())
      .optional(),
    severity: z.string().trim().min(1).max(40).optional(),
    alertType: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .transform((value) => value.toLowerCase())
      .optional(),
    from: z.iso.datetime({ offset: true, local: false }).optional(),
    to: z.iso.datetime({ offset: true, local: false }).optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type AlertListQuery = z.infer<typeof AlertListQuerySchema>;

export const AlertRecordSchema = z
  .object({
    id: IdentifierSchema,
    source: z.string().trim().min(1).max(120),
    externalId: z.string().trim().min(1).max(200).optional(),
    alertType: z.string().trim().min(1).max(120).optional(),
    title: z.string().trim().min(1).max(500),
    severity: AlertSeveritySchema,
    observedAt: UtcTimestampSchema,
    ingestedAt: UtcTimestampSchema,
    payload: z.record(z.string(), z.unknown()),
    sourceMetadata: z.record(z.string(), z.unknown()).optional(),
    normalizedAttributes: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type AlertRecord = z.infer<typeof AlertRecordSchema>;

export const AlertIngestResponseSchema = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('accepted'), alert: AlertRecordSchema })
    .strict(),
  z
    .object({ status: z.literal('duplicate'), alertId: IdentifierSchema })
    .strict(),
]);

export const AlertBatchItemSchema = z
  .object({
    index: z.number().int().min(0),
    status: z.enum(['accepted', 'duplicate', 'rejected', 'failed']),
    alertId: IdentifierSchema.optional(),
    error: z
      .object({
        code: z.enum(['VALIDATION_ERROR', 'CONFLICT', 'INTERNAL_SERVER_ERROR']),
        message: z.string().trim().min(1).max(500),
        details: z
          .array(
            z
              .object({
                path: z
                  .array(
                    z.union([z.string().max(200), z.number().int().min(0)]),
                  )
                  .max(32),
                message: z.string().trim().min(1).max(1000),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const AlertBatchResponseSchema = z
  .object({
    accepted: z.number().int().min(0),
    rejected: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    failed: z.number().int().min(0),
    records: z.array(AlertBatchItemSchema).max(MAX_ALERT_BATCH_RECORDS),
  })
  .strict()
  .refine(
    (summary) =>
      summary.accepted +
        summary.rejected +
        summary.duplicate +
        summary.failed ===
      summary.records.length,
    'Batch totals must equal the number of processed records.',
  );

export const AlertListResponseSchema = z
  .object({
    items: z.array(AlertRecordSchema).max(100),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    hasNext: z.boolean(),
    totalItems: z.number().int().min(0),
  })
  .strict();

export type AlertBatchResponse = z.infer<typeof AlertBatchResponseSchema>;
