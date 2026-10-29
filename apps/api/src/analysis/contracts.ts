import {
  AnalysisEvidenceValidationStatusSchema,
  AlertSeveritySchema,
  IdentifierSchema,
  IncidentAnalysisConflictSchema,
  IncidentAnalysisFindingSchema,
  IncidentAnalysisMethodSchema,
  UtcTimestampSchema,
} from '@cybernexus/shared';
import { z } from 'zod';

export const RequestIncidentAnalysisSchema = z.object({}).strict().default({});

export const ValidatedAnalysisFindingSchema =
  IncidentAnalysisFindingSchema.extend({
    evidenceValidationStatus: AnalysisEvidenceValidationStatusSchema,
  }).strict();

export const StoredIncidentAnalysisSchema = z
  .object({
    id: IdentifierSchema,
    requestId: IdentifierSchema,
    incidentId: IdentifierSchema,
    status: z.literal('completed'),
    analysisMethod: IncidentAnalysisMethodSchema,
    summary: z.string().trim().min(1).max(2000),
    proposedSeverity: AlertSeveritySchema,
    analysisConfidence: z.number().min(0).max(1),
    validationStatus: AnalysisEvidenceValidationStatusSchema,
    semanticVerification: z.literal('not_performed'),
    findings: z.array(ValidatedAnalysisFindingSchema).max(20),
    missingInformation: z.array(z.string().trim().min(1).max(500)).max(20),
    reportedConflicts: z.array(IncidentAnalysisConflictSchema).max(10),
    recommendedNextSteps: z.array(z.string().trim().min(1).max(500)).max(20),
    needsHumanReview: z.boolean(),
    humanReviewRationale: z.string().trim().min(1).max(1000),
    abstentionReason: z.string().trim().min(1).max(1000).optional(),
    sourceAlertIds: z.array(IdentifierSchema).min(1).max(100),
    sourceRelationshipIds: z.array(IdentifierSchema).max(800),
    sourceSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type StoredIncidentAnalysis = z.infer<
  typeof StoredIncidentAnalysisSchema
>;

export class InvalidAnalysisEvidenceError extends Error {}
