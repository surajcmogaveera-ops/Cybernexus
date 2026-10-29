import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  AnalysisEvidenceValidationStatusSchema,
  IncidentAnalysisConflictSchema,
  IncidentAnalysisRequestSchema,
  type IncidentAnalysisRequest,
  type IncidentAnalysisResult,
} from '@cybernexus/shared';
import { writeAuditEvent } from '../audit/write-audit-event.js';
import {
  InvalidAnalysisEvidenceError,
  StoredIncidentAnalysisSchema,
  type StoredIncidentAnalysis,
} from './contracts.js';
import { validateIncidentAnalysisEvidence } from './evidence-validation.js';
import {
  AnalysisServiceUnavailable,
  InvalidAnalysisServiceResponse,
  type IncidentAnalysisService,
} from './service-client.js';

export class IncidentAnalysisNotFoundError extends Error {}
export class IncidentAnalysisNoAlertsError extends Error {}

export async function runIncidentAnalysis(
  database: PrismaClient,
  service: IncidentAnalysisService,
  incidentId: string,
  actorId: string,
): Promise<StoredIncidentAnalysis> {
  const incident = await database.incident.findUnique({
    where: { id: incidentId },
    include: {
      alertLinks: { include: { alert: true }, orderBy: { alertId: 'asc' } },
    },
  });
  if (!incident) throw new IncidentAnalysisNotFoundError();
  if (incident.alertLinks.length === 0)
    throw new IncidentAnalysisNoAlertsError();

  const alertIds = incident.alertLinks.map(({ alertId }) => alertId);
  const relationships = await database.alertRelationship.findMany({
    where: { sourceAlertId: { in: alertIds }, targetAlertId: { in: alertIds } },
    orderBy: [{ id: 'asc' }],
  });
  const requestId = randomUUID();
  const request = IncidentAnalysisRequestSchema.parse({
    contractVersion: 'v1',
    requestId,
    incidentId: incident.id,
    incidentSeverity: incident.severity,
    alerts: incident.alertLinks.map(({ alert }) => ({
      id: alert.id,
      source: alert.source,
      ...(alert.alertType === null ? {} : { alertType: alert.alertType }),
      title: alert.title,
      severity: alert.severity,
      observedAt: alert.observedAt.toISOString(),
    })),
    relationships: relationships.map((relationship) => ({
      id: relationship.id,
      sourceAlertId: relationship.sourceAlertId,
      targetAlertId: relationship.targetAlertId,
      relationshipType: relationship.relationshipType,
      confidence: relationship.confidence,
      rationale: relationship.rationale,
      status: relationship.status,
    })),
  });

  let rawResult: IncidentAnalysisResult;
  try {
    rawResult = await service.analyze(request);
  } catch (error) {
    await writeAnalysisFailureAudit(database, requestId, actorId, error);
    throw error;
  }

  let validated: ReturnType<typeof validateIncidentAnalysisEvidence>;
  try {
    validated = validateIncidentAnalysisEvidence(request, rawResult);
  } catch {
    await writeAnalysisFailureAudit(
      database,
      requestId,
      actorId,
      new InvalidAnalysisEvidenceError(),
    );
    throw new InvalidAnalysisEvidenceError();
  }

  const sourceSnapshotHash = hashSourceSnapshot(request);
  const result = validated.result;
  const humanReviewRationale = result.needsHumanReview
    ? result.humanReviewRationale!
    : 'Application policy requires an analyst to review unverified analysis claims.';
  const include = {
    findings: { include: { evidence: true }, orderBy: { id: 'asc' as const } },
    alerts: { select: { alertId: true }, orderBy: { alertId: 'asc' as const } },
    evidence: {
      orderBy: [{ kind: 'asc' as const }, { referenceId: 'asc' as const }],
    },
  };

  const run = await database.$transaction(async (transaction) => {
    const created = await transaction.analysisRun.create({
      data: {
        id: randomUUID(),
        requestId,
        contractVersion: 'v1',
        status: 'completed',
        maxFindings: 20,
        includeRecommendations: true,
        completedAt: new Date(),
        abstentionReason: result.abstentionReason,
        missingInformation: result.missingInformation,
        recommendedNextSteps: result.recommendedNextSteps,
        summary: result.summary,
        proposedSeverity: result.proposedSeverity,
        analysisConfidence: result.analysisConfidence,
        validationStatus: validated.validationStatus,
        providerId: result.analysisMethod,
        needsHumanReview: true,
        humanReviewRationale,
        reportedConflicts:
          result.reportedConflicts as unknown as Prisma.InputJsonValue,
        sourceSnapshotHash,
        incidentId: incident.id,
        alerts: {
          create: incident.alertLinks.map(({ alertId }) => ({ alertId })),
        },
        evidence: {
          create: validated.evidenceReferences.map((reference) => ({
            kind: reference.kind,
            referenceId: reference.id,
            fieldPaths: reference.fieldPaths,
          })),
        },
        findings: {
          create: result.findings.map((finding, index) => ({
            conclusion: finding.conclusion,
            rationale: finding.rationale,
            confidence: finding.confidence,
            uncertainty: finding.uncertainty,
            verificationStatus: 'unverified',
            evidenceValidationStatus: validated.findingStatuses[index]!,
            evidence: {
              create: finding.evidence.map((reference) => ({
                kind: reference.kind,
                referenceId: reference.id,
                fieldPaths: reference.fieldPaths,
              })),
            },
          })),
        },
      },
      include,
    });
    await writeAuditEvent(transaction, {
      eventType: 'incident.analysis.completed',
      targetType: 'AnalysisRun',
      targetId: created.id,
      actorId,
      metadata: {
        incidentId: incident.id,
        analysisMethod: result.analysisMethod,
        validationStatus: validated.validationStatus,
        sourceAlertCount: alertIds.length,
        sourceRelationshipCount: relationships.length,
        findingCount: result.findings.length,
        needsHumanReview: true,
        sourceSnapshotHash,
      },
    });
    return created;
  });
  return toStoredIncidentAnalysis(run, incident.id, humanReviewRationale);
}

export async function getStoredIncidentAnalysis(
  database: PrismaClient,
  incidentId: string,
  analysisRunId?: string,
): Promise<StoredIncidentAnalysis | undefined> {
  const incident = await database.incident.findUnique({
    where: { id: incidentId },
    select: { id: true },
  });
  if (!incident) throw new IncidentAnalysisNotFoundError();

  const run = await database.analysisRun.findFirst({
    where: {
      incidentId,
      status: 'completed',
      summary: { not: null },
      ...(analysisRunId ? { id: analysisRunId } : {}),
    },
    include: {
      findings: {
        include: { evidence: true },
        orderBy: { id: 'asc' },
      },
      alerts: { select: { alertId: true }, orderBy: { alertId: 'asc' } },
      evidence: {
        orderBy: [{ kind: 'asc' }, { referenceId: 'asc' }],
      },
    },
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
  });
  if (!run || !run.summary || !run.providerId || !run.validationStatus) {
    return undefined;
  }
  return toStoredIncidentAnalysis(run, incidentId, run.humanReviewRationale);
}

export function hashSourceSnapshot(request: IncidentAnalysisRequest): string {
  const snapshot = {
    contractVersion: request.contractVersion,
    incidentId: request.incidentId,
    incidentSeverity: request.incidentSeverity,
    alerts: request.alerts,
    relationships: request.relationships,
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

async function writeAnalysisFailureAudit(
  database: PrismaClient,
  requestId: string,
  actorId: string,
  error: unknown,
): Promise<void> {
  const failureClass =
    error instanceof AnalysisServiceUnavailable
      ? 'service_unavailable'
      : error instanceof InvalidAnalysisServiceResponse ||
          error instanceof InvalidAnalysisEvidenceError
        ? 'invalid_service_output'
        : 'analysis_failed';
  await database.$transaction((transaction) =>
    writeAuditEvent(transaction, {
      eventType: 'incident.analysis.failed',
      targetType: 'AnalysisRunRequest',
      targetId: requestId,
      actorId,
      metadata: { failureClass },
    }),
  );
}

function toStoredIncidentAnalysis(
  run: {
    id: string;
    requestId: string;
    incidentId: string | null;
    status: string;
    providerId: string | null;
    summary: string | null;
    proposedSeverity: string | null;
    analysisConfidence: number | null;
    validationStatus: string | null;
    needsHumanReview: boolean | null;
    humanReviewRationale: string | null;
    abstentionReason: string | null;
    missingInformation: string[];
    recommendedNextSteps: string[];
    reportedConflicts: Prisma.JsonValue | null;
    sourceSnapshotHash: string | null;
    requestedAt: Date;
    findings: {
      conclusion: string;
      rationale: string;
      confidence: number;
      uncertainty: string | null;
      verificationStatus: string;
      evidenceValidationStatus: string | null;
      evidence: {
        kind: string;
        referenceId: string;
        fieldPaths: string[];
      }[];
    }[];
    alerts: { alertId: string }[];
    evidence: { kind: string; referenceId: string }[];
  },
  incidentId: string,
  humanReviewRationale: string | null,
): StoredIncidentAnalysis {
  const conflicts = IncidentAnalysisConflictSchema.array().parse(
    run.reportedConflicts ?? [],
  );
  return StoredIncidentAnalysisSchema.parse({
    id: run.id,
    requestId: run.requestId,
    incidentId,
    status: run.status,
    analysisMethod: run.providerId,
    summary: run.summary,
    proposedSeverity: run.proposedSeverity,
    analysisConfidence: run.analysisConfidence,
    validationStatus: AnalysisEvidenceValidationStatusSchema.parse(
      run.validationStatus,
    ),
    semanticVerification: 'not_performed',
    findings: run.findings.map((finding) => ({
      conclusion: finding.conclusion,
      rationale: finding.rationale,
      evidence: finding.evidence.map((reference) => ({
        kind: reference.kind,
        id: reference.referenceId,
        fieldPaths: reference.fieldPaths,
      })),
      confidence: finding.confidence,
      ...(finding.uncertainty === null
        ? {}
        : { uncertainty: finding.uncertainty }),
      verificationStatus: finding.verificationStatus,
      evidenceValidationStatus: AnalysisEvidenceValidationStatusSchema.parse(
        finding.evidenceValidationStatus,
      ),
    })),
    missingInformation: run.missingInformation,
    reportedConflicts: conflicts,
    recommendedNextSteps: run.recommendedNextSteps,
    needsHumanReview: run.needsHumanReview === true,
    humanReviewRationale:
      humanReviewRationale ??
      'Analysis claims remain unverified and require human review.',
    ...(run.abstentionReason === null
      ? {}
      : { abstentionReason: run.abstentionReason }),
    sourceAlertIds: run.alerts.map(({ alertId }) => alertId).sort(),
    sourceRelationshipIds: run.evidence
      .filter(({ kind }) => kind === 'relationship')
      .map(({ referenceId }) => referenceId)
      .sort(),
    sourceSnapshotHash: run.sourceSnapshotHash,
    createdAt: run.requestedAt.toISOString(),
  });
}
