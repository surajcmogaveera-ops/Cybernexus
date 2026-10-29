import { z } from 'zod';

export const IdentifierSchema = z.uuid();
export type Identifier = z.infer<typeof IdentifierSchema>;

/** CyberNexus wire timestamps are ISO 8601 UTC values ending in Z. */
export const UtcTimestampSchema = z.iso.datetime({
  offset: false,
  local: false,
});
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
    externalId: z.string().trim().min(1).max(200).optional(),
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
    path: z
      .array(z.union([z.string().max(200), z.number().int().min(0)]))
      .max(32),
    message: z.string().trim().min(1).max(1000),
  })
  .strict();
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'MALFORMED_JSON',
  'NOT_FOUND',
  'UNSUPPORTED_CONTRACT_VERSION',
  'CONFLICT',
  'INTERNAL_SERVER_ERROR',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().trim().min(1).max(500),
        details: z.array(ApiErrorDetailSchema).max(100).optional(),
      })
      .strict(),
  })
  .strict();
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** Express gateway errors that are separate from the FastAPI service error contract. */
export const ApiGatewayErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_UNAVAILABLE',
  'FORBIDDEN',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
]);
export type ApiGatewayErrorCode = z.infer<typeof ApiGatewayErrorCodeSchema>;

export const ApiGatewayErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: ApiGatewayErrorCodeSchema,
        message: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict();
export type ApiGatewayErrorResponse = z.infer<
  typeof ApiGatewayErrorResponseSchema
>;

export const ApiScopeSchema = z.enum([
  'api:read',
  'api:write',
  'audit:read',
  'audit:write',
]);
export type ApiScope = z.infer<typeof ApiScopeSchema>;

export const ApiSessionResponseSchema = z
  .object({
    subject: z.string().trim().min(1).max(120),
    scopes: z.array(ApiScopeSchema).max(10),
  })
  .strict();
export type ApiSessionResponse = z.infer<typeof ApiSessionResponseSchema>;

/** Major wire-contract version. Increment only for incompatible changes. */
export const ContractVersionSchema = z.literal('v1');
export type ContractVersion = z.infer<typeof ContractVersionSchema>;

export const PaginationRequestSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type PaginationRequest = z.infer<typeof PaginationRequestSchema>;

export const PaginationResponseSchema = z
  .object({
    items: z.array(z.record(z.string(), z.unknown())).max(100),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    hasNext: z.boolean(),
    totalItems: z.number().int().min(0).optional(),
  })
  .strict();
export type PaginationResponse = z.infer<typeof PaginationResponseSchema>;

export const EvidenceReferenceSchema = z
  .object({
    kind: z.enum(['alert', 'artifact', 'log', 'other']),
    id: IdentifierSchema,
  })
  .strict();
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const AnalysisOptionsSchema = z
  .object({
    maxFindings: z.number().int().min(1).max(20).default(10),
    includeRecommendations: z.boolean().default(true),
  })
  .strict();
export type AnalysisOptions = z.infer<typeof AnalysisOptionsSchema>;

export const AnalysisRequestSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    requestId: IdentifierSchema,
    alertIds: z.array(IdentifierSchema).min(1).max(100),
    evidence: z.array(EvidenceReferenceSchema).max(100).default([]),
    context: z.string().max(4000).optional(),
    options: AnalysisOptionsSchema.default({
      maxFindings: 10,
      includeRecommendations: true,
    }),
  })
  .strict();
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;

export const AnalysisFindingSchema = z
  .object({
    conclusion: z.string().trim().min(1).max(1000),
    rationale: z.string().trim().min(1).max(2000),
    evidence: z.array(EvidenceReferenceSchema).max(20),
    confidence: z.number().min(0).max(1),
    uncertainty: z.string().max(1000).optional(),
    verificationStatus: z.literal('unverified'),
  })
  .strict();
export type AnalysisFinding = z.infer<typeof AnalysisFindingSchema>;

export const AnalysisResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    requestId: IdentifierSchema,
    findings: z.array(AnalysisFindingSchema).max(20),
    missingInformation: z
      .array(z.string().trim().min(1).max(500))
      .max(20)
      .default([]),
    abstentionReason: z.string().trim().min(1).max(1000).optional(),
    recommendedNextSteps: z
      .array(z.string().trim().min(1).max(500))
      .max(20)
      .default([]),
  })
  .strict();
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

/** Incident-scoped inputs used by the private structured investigation service. */
export const IncidentAnalysisAlertSchema = z
  .object({
    id: IdentifierSchema,
    source: z.string().trim().min(1).max(120),
    alertType: z.string().trim().min(1).max(120).optional(),
    title: z.string().trim().min(1).max(500),
    severity: AlertSeveritySchema,
    observedAt: UtcTimestampSchema,
  })
  .strict();
export type IncidentAnalysisAlert = z.infer<typeof IncidentAnalysisAlertSchema>;

export const IncidentAnalysisRelationshipSchema = z
  .object({
    id: IdentifierSchema,
    sourceAlertId: IdentifierSchema,
    targetAlertId: IdentifierSchema,
    relationshipType: z.enum([
      'shared_user',
      'shared_device',
      'shared_cloud_resource',
      'shared_ip',
    ]),
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(1000),
    status: z.enum(['proposed', 'review_required', 'accepted', 'rejected']),
  })
  .strict();
export type IncidentAnalysisRelationship = z.infer<
  typeof IncidentAnalysisRelationshipSchema
>;

export const IncidentAnalysisRequestSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    requestId: IdentifierSchema,
    incidentId: IdentifierSchema,
    incidentSeverity: AlertSeveritySchema,
    alerts: z.array(IncidentAnalysisAlertSchema).min(1).max(100),
    relationships: z.array(IncidentAnalysisRelationshipSchema).max(800),
  })
  .strict()
  .superRefine(({ alerts, relationships }, context) => {
    const alertIds = new Set(alerts.map(({ id }) => id));
    if (alertIds.size !== alerts.length) {
      context.addIssue({
        code: 'custom',
        path: ['alerts'],
        message: 'Analysis input cannot repeat alert IDs.',
      });
    }
    if (
      relationships.some(
        ({ sourceAlertId, targetAlertId }) =>
          !alertIds.has(sourceAlertId) || !alertIds.has(targetAlertId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['relationships'],
        message: 'Analysis relationships must belong to the supplied alerts.',
      });
    }
  });
export type IncidentAnalysisRequest = z.infer<
  typeof IncidentAnalysisRequestSchema
>;

export const IncidentAnalysisEvidenceReferenceSchema = z
  .object({
    kind: z.enum(['alert', 'relationship']),
    id: IdentifierSchema,
    fieldPaths: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
  })
  .strict()
  .superRefine(({ fieldPaths }, context) => {
    if (new Set(fieldPaths).size !== fieldPaths.length) {
      context.addIssue({
        code: 'custom',
        path: ['fieldPaths'],
        message: 'Evidence field paths must be unique.',
      });
    }
  });
export type IncidentAnalysisEvidenceReference = z.infer<
  typeof IncidentAnalysisEvidenceReferenceSchema
>;

export const IncidentAnalysisFindingSchema = z
  .object({
    conclusion: z.string().trim().min(1).max(1000),
    rationale: z.string().trim().min(1).max(2000),
    evidence: z.array(IncidentAnalysisEvidenceReferenceSchema).max(20),
    confidence: z.number().min(0).max(1),
    uncertainty: z.string().trim().min(1).max(1000).optional(),
    verificationStatus: z.literal('unverified'),
  })
  .strict();
export type IncidentAnalysisFinding = z.infer<
  typeof IncidentAnalysisFindingSchema
>;

export const IncidentAnalysisConflictSchema = z
  .object({
    description: z.string().trim().min(1).max(1000),
    evidence: z.array(IncidentAnalysisEvidenceReferenceSchema).min(1).max(20),
  })
  .strict();

export const IncidentAnalysisMethodSchema = z.enum([
  'deterministic_fallback',
  'gemini',
]);
export type IncidentAnalysisMethod = z.infer<
  typeof IncidentAnalysisMethodSchema
>;

export const IncidentAnalysisResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    requestId: IdentifierSchema,
    analysisMethod: IncidentAnalysisMethodSchema,
    summary: z.string().trim().min(1).max(2000),
    proposedSeverity: AlertSeveritySchema,
    /** Alert-reference coverage, not a probability or semantic truth score. */
    analysisConfidence: z.number().min(0).max(1),
    findings: z.array(IncidentAnalysisFindingSchema).max(20),
    missingInformation: z.array(z.string().trim().min(1).max(500)).max(20),
    reportedConflicts: z.array(IncidentAnalysisConflictSchema).max(10),
    recommendedNextSteps: z.array(z.string().trim().min(1).max(500)).max(20),
    needsHumanReview: z.boolean(),
    humanReviewRationale: z.string().trim().min(1).max(1000).optional(),
    abstentionReason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.needsHumanReview && !result.humanReviewRationale) {
      context.addIssue({
        code: 'custom',
        path: ['humanReviewRationale'],
        message: 'Human review requires an explanation.',
      });
    }
  });
export type IncidentAnalysisResult = z.infer<
  typeof IncidentAnalysisResultSchema
>;

export const AnalysisEvidenceValidationStatusSchema = z.enum([
  'references_validated',
  'insufficient_evidence',
  'reported_conflicts',
]);
export type AnalysisEvidenceValidationStatus = z.infer<
  typeof AnalysisEvidenceValidationStatusSchema
>;

export const CorrelationEntityTypeSchema = z.enum([
  'user',
  'device',
  'cloud_resource',
  'ip',
]);
export type CorrelationEntityType = z.infer<typeof CorrelationEntityTypeSchema>;

export const CorrelationRelationshipTypeSchema = z.enum([
  'shared_user',
  'shared_device',
  'shared_cloud_resource',
  'shared_ip',
]);
export type CorrelationRelationshipType = z.infer<
  typeof CorrelationRelationshipTypeSchema
>;

export const CorrelationStatusSchema = z.enum([
  'proposed',
  'review_required',
  'accepted',
  'rejected',
]);
export type CorrelationStatus = z.infer<typeof CorrelationStatusSchema>;

export const CorrelationEntitySchema = z
  .object({
    entityType: CorrelationEntityTypeSchema,
    value: z.string().trim().min(1).max(512),
    fieldPath: z.string().trim().min(1).max(160),
  })
  .strict();
export type CorrelationEntity = z.infer<typeof CorrelationEntitySchema>;

export const CorrelationAlertInputSchema = z
  .object({
    id: IdentifierSchema,
    source: z.string().trim().min(1).max(120),
    alertType: z.string().trim().min(1).max(120).optional(),
    observedAt: UtcTimestampSchema,
    entities: z.array(CorrelationEntitySchema).max(8),
  })
  .strict();
export type CorrelationAlertInput = z.infer<typeof CorrelationAlertInputSchema>;

export const CorrelationRequestSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    requestId: IdentifierSchema,
    alerts: z.array(CorrelationAlertInputSchema).min(1).max(100),
  })
  .strict()
  .superRefine(({ alerts }, context) => {
    const ids = alerts.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['alerts'],
        message: 'Correlation requests cannot repeat alert IDs.',
      });
    }
  });
export type CorrelationRequest = z.infer<typeof CorrelationRequestSchema>;

export const CorrelationEvidenceSchema = z
  .object({
    entityType: CorrelationEntityTypeSchema,
    sourceField: z.string().trim().min(1).max(160),
    targetField: z.string().trim().min(1).max(160),
  })
  .strict();
export type CorrelationEvidence = z.infer<typeof CorrelationEvidenceSchema>;

export const CorrelationCandidateSchema = z
  .object({
    sourceAlertId: IdentifierSchema,
    targetAlertId: IdentifierSchema,
    relationshipType: CorrelationRelationshipTypeSchema,
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(1000),
    evidence: z.array(CorrelationEvidenceSchema).min(1).max(16),
    status: CorrelationStatusSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.sourceAlertId === candidate.targetAlertId) {
      context.addIssue({
        code: 'custom',
        path: ['targetAlertId'],
        message: 'A relationship must connect two different alerts.',
      });
    }
  });
export type CorrelationCandidate = z.infer<typeof CorrelationCandidateSchema>;

export const CorrelationResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    requestId: IdentifierSchema,
    relationships: z.array(CorrelationCandidateSchema).max(800),
  })
  .strict();
export type CorrelationResult = z.infer<typeof CorrelationResultSchema>;

export const IncidentPrioritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'unclassified',
]);
export type IncidentPriority = z.infer<typeof IncidentPrioritySchema>;

export const IncidentPriorityOverrideSchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
]);
export type IncidentPriorityOverride = z.infer<
  typeof IncidentPriorityOverrideSchema
>;

export const IncidentPriorityOverrideResponseSchema = z
  .object({
    incidentId: IdentifierSchema,
    previousOverride: IncidentPriorityOverrideSchema.nullable(),
    priorityOverride: IncidentPriorityOverrideSchema,
    effectivePriority: IncidentPriorityOverrideSchema,
    reason: z.string().trim().min(1).max(1000),
    actorId: z.string().trim().min(1).max(120),
    changedAt: UtcTimestampSchema,
  })
  .strict();
export type IncidentPriorityOverrideResponse = z.infer<
  typeof IncidentPriorityOverrideResponseSchema
>;

export const SlaStateSchema = z.enum([
  'on_track',
  'approaching_deadline',
  'overdue',
  'met',
  'breached',
  'deadline_unknown',
]);
export type SlaState = z.infer<typeof SlaStateSchema>;

export const BreachRiskBandSchema = z.enum([
  'low',
  'moderate',
  'high',
  'unknown',
  'not_applicable',
]);
export type BreachRiskBand = z.infer<typeof BreachRiskBandSchema>;

export const PriorityFactorSchema = z
  .object({
    factor: z.enum([
      'severity_base',
      'alert_convergence',
      'accepted_relationship',
      'review_required_relationship',
      'deadline_urgency',
    ]),
    points: z.number().int().min(0).max(100).nullable(),
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();
export type PriorityFactor = z.infer<typeof PriorityFactorSchema>;

export const IncidentPriorityResponseSchema = z
  .object({
    incidentId: IdentifierSchema,
    severity: AlertSeveritySchema,
    analysisConfidence: z.number().min(0).max(1).nullable(),
    policyVersion: z.string().trim().min(1).max(40),
    calculatedAt: UtcTimestampSchema,
    riskScore: z.number().int().min(0).max(100).nullable(),
    recommendedPriority: IncidentPrioritySchema,
    effectivePriority: IncidentPriorityOverrideSchema.or(
      z.literal('unclassified'),
    ),
    priorityOverride: IncidentPriorityOverrideSchema.nullable(),
    overrideReason: z.string().trim().min(1).max(1000).nullable(),
    factors: z.array(PriorityFactorSchema).max(10),
    unavailableInputs: z.array(z.string().trim().min(1).max(200)).max(20),
  })
  .strict();
export type IncidentPriorityResponse = z.infer<
  typeof IncidentPriorityResponseSchema
>;

export const IncidentSlaResponseSchema = z
  .object({
    incidentId: IdentifierSchema,
    policyVersion: z.string().trim().min(1).max(40),
    responseTargetMinutes: z.number().int().positive().nullable(),
    referenceAt: UtcTimestampSchema,
    deadlineAt: UtcTimestampSchema.nullable(),
    remainingMinutes: z.number().int().nullable(),
    approachingThresholdPercent: z.number().int().min(1).max(100),
    state: SlaStateSchema,
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();
export type IncidentSlaResponse = z.infer<typeof IncidentSlaResponseSchema>;

export const IncidentBreachRiskResponseSchema = z
  .object({
    incidentId: IdentifierSchema,
    policyVersion: z.string().trim().min(1).max(40),
    band: BreachRiskBandSchema,
    predictiveModel: z.literal(false),
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();
export type IncidentBreachRiskResponse = z.infer<
  typeof IncidentBreachRiskResponseSchema
>;

export const IncidentResponsePlanStepSchema = z
  .object({
    order: z.number().int().min(1).max(20),
    action: z.string().trim().min(1).max(300),
    rationale: z.string().trim().min(1).max(500),
    evidence: z
      .array(
        z
          .object({
            kind: z.enum(['alert', 'relationship']),
            id: IdentifierSchema,
          })
          .strict(),
      )
      .max(20),
    status: z.literal('suggested'),
    approvalStatus: z.literal('review_required'),
    performed: z.literal(false),
  })
  .strict();
export type IncidentResponsePlanStep = z.infer<
  typeof IncidentResponsePlanStepSchema
>;

export const IncidentResponsePlanSchema = z
  .object({
    incidentId: IdentifierSchema,
    generatedAt: UtcTimestampSchema,
    steps: z.array(IncidentResponsePlanStepSchema).max(20),
  })
  .strict();
export type IncidentResponsePlan = z.infer<typeof IncidentResponsePlanSchema>;

export const IncidentAuditEventSchema = z
  .object({
    id: IdentifierSchema,
    eventType: z.string().trim().min(1).max(120),
    targetType: z.string().trim().min(1).max(120),
    targetId: IdentifierSchema,
    actorId: z.string().trim().min(1).max(120).nullable(),
    occurredAt: UtcTimestampSchema,
    metadata: z.record(
      z.string().max(80),
      z.union([
        z.string().max(1000),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    ),
  })
  .strict();
export type IncidentAuditEvent = z.infer<typeof IncidentAuditEventSchema>;

export const IncidentAuditHistoryResponseSchema = z
  .object({
    incidentId: IdentifierSchema,
    items: z.array(IncidentAuditEventSchema).max(100),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    hasNext: z.boolean(),
    totalItems: z.number().int().min(0),
  })
  .strict();
export type IncidentAuditHistoryResponse = z.infer<
  typeof IncidentAuditHistoryResponseSchema
>;
