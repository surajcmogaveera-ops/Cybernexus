import { z } from 'zod';

export const IdentifierSchema = z.uuid();
export type Identifier = z.infer<typeof IdentifierSchema>;

/** CyberNexus wire timestamps are ISO 8601 UTC values ending in Z. */
export const UtcTimestampSchema = z.iso.datetime();
export type UtcTimestamp = z.infer<typeof UtcTimestampSchema>;

export const AlertSeveritySchema = z.enum([
  'informational',
  'low',
  'medium',
  'high',
  'critical',
  'unknown',
]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

const AlertFieldsSchema = z
  .object({
    source: z.string().trim().min(1).max(120),
    externalId: z.string().trim().min(1).max(200),
    observedAt: UtcTimestampSchema,
    title: z.string().trim().min(1).max(500),
    severity: AlertSeveritySchema,
    /** Original provider fields are untrusted data and must be preserved as-is. */
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const AlertInputSchema = AlertFieldsSchema;
export type AlertInput = z.infer<typeof AlertInputSchema>;

export const SecurityAlertSchema = AlertFieldsSchema.extend({
  id: IdentifierSchema,
  ingestedAt: UtcTimestampSchema,
}).strict();
export type SecurityAlert = z.infer<typeof SecurityAlertSchema>;

export const IncidentStatusSchema = z.enum([
  'new',
  'triaged',
  'investigating',
  'resolved',
  'closed',
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().trim().min(1).max(500),
    alertIds: z.array(IdentifierSchema).min(1),
    status: IncidentStatusSchema,
    severity: AlertSeveritySchema,
    // Analysis can be absent until evidence has been reviewed.
    riskScore: z.number().min(0).max(100).optional(),
    confidence: z.number().min(0).max(1).optional(),
    needsHumanReview: z.boolean().optional(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type Incident = z.infer<typeof IncidentSchema>;

export const AnalystAvailabilitySchema = z.enum(['available', 'unavailable']);
export type AnalystAvailability = z.infer<typeof AnalystAvailabilitySchema>;

export const AnalystSchema = z
  .object({
    id: IdentifierSchema,
    displayName: z.string().trim().min(1).max(120),
    skills: z.array(z.string().trim().min(1).max(80)).max(100),
    availability: AnalystAvailabilitySchema,
  })
  .strict();
export type Analyst = z.infer<typeof AnalystSchema>;

export const AssignmentStatusSchema = z.enum([
  'active',
  'reassigned',
  'completed',
  'cancelled',
]);
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;

export const AssignmentSchema = z
  .object({
    id: IdentifierSchema,
    incidentId: IdentifierSchema,
    analystId: IdentifierSchema,
    status: AssignmentStatusSchema,
    assignedAt: UtcTimestampSchema,
    explanation: z.string().trim().min(1).max(2000),
  })
  .strict();
export type Assignment = z.infer<typeof AssignmentSchema>;

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string().trim().min(1).max(120),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorDetailSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string().min(1),
  })
  .strict();
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

export const ApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().trim().min(1).max(100),
        message: z.string().trim().min(1).max(500),
        details: z.array(ApiErrorDetailSchema).optional(),
      })
      .strict(),
  })
  .strict();
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
