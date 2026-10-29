import {
  AlertSeveritySchema,
  CorrelationEntityTypeSchema,
  CorrelationStatusSchema,
  IncidentStatusSchema,
  IdentifierSchema,
  UtcTimestampSchema,
} from '@cybernexus/shared';
import { z } from 'zod';
import { AlertRecordSchema } from '../alerts/contracts.js';
import { PersistedRelationshipSchema } from '../correlation/contracts.js';

export const IncidentRecordSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().optional(),
    status: IncidentStatusSchema,
    severity: AlertSeveritySchema,
    needsHumanReview: z.boolean().optional(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
    alertIds: z.array(IdentifierSchema).min(1).max(100),
  })
  .strict();
export type IncidentRecord = z.infer<typeof IncidentRecordSchema>;

export const IncidentListQuerySchema = z
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
    status: IncidentStatusSchema.optional(),
    severity: AlertSeveritySchema.optional(),
  })
  .strict();

export const IncidentListResponseSchema = z
  .object({
    items: z.array(IncidentRecordSchema).max(100),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    hasNext: z.boolean(),
    totalItems: z.number().int().min(0),
  })
  .strict();

export const IncidentDetailResponseSchema = z
  .object({
    incident: IncidentRecordSchema,
    alerts: z.array(AlertRecordSchema).max(100),
    relationships: z.array(PersistedRelationshipSchema).max(800),
  })
  .strict();

export const IncidentTimelineEventSchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum([
      'incident_created',
      'alert_observed',
      'relationship_proposed',
      'relationship_reviewed',
      'status_changed',
    ]),
    occurredAt: UtcTimestampSchema,
    title: z.string().trim().min(1).max(500),
    details: z.string().trim().min(1).max(1000).optional(),
    alertId: IdentifierSchema.optional(),
    relationshipId: IdentifierSchema.optional(),
    source: z.string().trim().min(1).max(120).optional(),
    externalId: z.string().trim().min(1).max(200).optional(),
    fromStatus: IncidentStatusSchema.optional(),
    toStatus: IncidentStatusSchema.optional(),
  })
  .strict();
export type IncidentTimelineEvent = z.infer<typeof IncidentTimelineEventSchema>;

export const IncidentTimelineResponseSchema = z
  .object({
    incidentId: IdentifierSchema,
    items: z.array(IncidentTimelineEventSchema).max(2000),
  })
  .strict();

export const IncidentGraphNodeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('incident'),
      id: IdentifierSchema,
      label: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal('alert'),
      id: IdentifierSchema,
      label: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal('entity'),
      id: IdentifierSchema,
      label: z.string().min(1).max(512),
      entityType: CorrelationEntityTypeSchema,
    })
    .strict(),
]);

export const IncidentGraphEdgeSchema = z
  .object({
    id: IdentifierSchema,
    sourceId: IdentifierSchema,
    targetId: IdentifierSchema,
    type: z.enum(['incident_alert', 'alert_entity', 'correlation']),
    relationshipStatus: CorrelationStatusSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const IncidentGraphResponseSchema = z
  .object({
    incidentId: IdentifierSchema,
    nodes: z.array(IncidentGraphNodeSchema).max(1000),
    edges: z.array(IncidentGraphEdgeSchema).max(2000),
  })
  .strict();

export const IncidentStatusUpdateSchema = z
  .object({ status: IncidentStatusSchema })
  .strict();

export const RelationshipStatusUpdateSchema = z
  .object({ status: z.enum(['accepted', 'rejected', 'review_required']) })
  .strict();
