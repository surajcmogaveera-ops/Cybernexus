import { z } from 'zod';
import {
  CorrelationCandidateSchema,
  CorrelationStatusSchema,
  CorrelationRelationshipTypeSchema,
  IdentifierSchema,
  IncidentStatusSchema,
  AlertSeveritySchema,
  UtcTimestampSchema,
} from '@cybernexus/shared';

export const CorrelationRunRequestSchema = z
  .object({
    alertIds: z.array(IdentifierSchema).min(1).max(100),
  })
  .strict()
  .superRefine(({ alertIds }, context) => {
    if (new Set(alertIds).size !== alertIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['alertIds'],
        message: 'Alert IDs must be unique.',
      });
    }
  });

export const PersistedRelationshipSchema = z
  .object({
    id: IdentifierSchema,
    sourceAlertId: IdentifierSchema,
    targetAlertId: IdentifierSchema,
    relationshipType: CorrelationRelationshipTypeSchema,
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(1000),
    evidence: z
      .array(CorrelationCandidateSchema.shape.evidence.element)
      .min(1)
      .max(16),
    status: CorrelationStatusSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict();

export const CorrelatedIncidentSummarySchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().trim().min(1).max(500),
    status: IncidentStatusSchema,
    severity: AlertSeveritySchema,
    needsHumanReview: z.boolean(),
    alertIds: z.array(IdentifierSchema).min(1).max(100),
  })
  .strict();

export const CorrelationRunResponseSchema = z
  .object({
    requestId: IdentifierSchema,
    processedAlertCount: z.number().int().min(1).max(100),
    candidateRelationshipCount: z.number().int().min(0).max(800),
    relationships: z.array(PersistedRelationshipSchema).max(800),
    incidents: z.array(CorrelatedIncidentSummarySchema).max(100),
    alertsRequiringReview: z.array(IdentifierSchema).max(100),
  })
  .strict();

export type CorrelationRunRequest = z.infer<typeof CorrelationRunRequestSchema>;
export type PersistedRelationship = z.infer<typeof PersistedRelationshipSchema>;
export type CorrelationRunResponse = z.infer<
  typeof CorrelationRunResponseSchema
>;
