import {
  IncidentAnalysisRequestSchema,
  IncidentAnalysisResultSchema,
  IncidentAnalysisEvidenceReferenceSchema,
  type AnalysisEvidenceValidationStatus,
  type IncidentAnalysisRequest,
  type IncidentAnalysisResult,
} from '@cybernexus/shared';
import { InvalidAnalysisEvidenceError } from './contracts.js';

const ALERT_FIELDS = new Set([
  'source',
  'alertType',
  'title',
  'severity',
  'observedAt',
]);
const RELATIONSHIP_FIELDS = new Set([
  'sourceAlertId',
  'targetAlertId',
  'relationshipType',
  'confidence',
  'rationale',
  'status',
]);

export type ValidatedIncidentAnalysis = {
  result: IncidentAnalysisResult;
  validationStatus: AnalysisEvidenceValidationStatus;
  findingStatuses: AnalysisEvidenceValidationStatus[];
  evidenceReferences: {
    kind: 'alert' | 'relationship';
    id: string;
    fieldPaths: string[];
  }[];
};

export function validateIncidentAnalysisEvidence(
  rawRequest: IncidentAnalysisRequest,
  rawResult: IncidentAnalysisResult,
): ValidatedIncidentAnalysis {
  const request = IncidentAnalysisRequestSchema.parse(rawRequest);
  const result = IncidentAnalysisResultSchema.parse(rawResult);
  if (result.requestId !== request.requestId) {
    throw new InvalidAnalysisEvidenceError('Analysis request ID mismatch.');
  }

  const alerts = new Map(request.alerts.map((item) => [item.id, item]));
  const relationships = new Map(
    request.relationships.map((item) => [item.id, item]),
  );
  const allReferences = new Map<
    string,
    { kind: 'alert' | 'relationship'; id: string; fieldPaths: Set<string> }
  >();

  const validateReference = (
    rawReference: unknown,
  ): { kind: 'alert' | 'relationship'; id: string; fieldPaths: string[] } => {
    const reference =
      IncidentAnalysisEvidenceReferenceSchema.parse(rawReference);
    const source =
      reference.kind === 'alert'
        ? alerts.get(reference.id)
        : relationships.get(reference.id);
    const allowed =
      reference.kind === 'alert' ? ALERT_FIELDS : RELATIONSHIP_FIELDS;
    if (!source) {
      throw new InvalidAnalysisEvidenceError(
        'Analysis referenced a record outside the incident snapshot.',
      );
    }
    if (
      reference.fieldPaths.some(
        (fieldPath) => !allowed.has(fieldPath) || !(fieldPath in source),
      )
    ) {
      throw new InvalidAnalysisEvidenceError(
        'Analysis referenced a field outside the incident snapshot.',
      );
    }
    const key = `${reference.kind}:${reference.id}`;
    const existing = allReferences.get(key) ?? {
      kind: reference.kind,
      id: reference.id,
      fieldPaths: new Set<string>(),
    };
    for (const fieldPath of reference.fieldPaths) {
      existing.fieldPaths.add(fieldPath);
    }
    allReferences.set(key, existing);
    return reference;
  };

  const findingStatuses = result.findings.map((finding) => {
    const validated = finding.evidence.map(validateReference);
    if (validated.length === 0) return 'insufficient_evidence';
    const cited = new Set(validated.map(({ kind, id }) => `${kind}:${id}`));
    if (
      result.reportedConflicts.some((conflict) =>
        conflict.evidence.some(({ kind, id }) => cited.has(`${kind}:${id}`)),
      )
    ) {
      return 'reported_conflicts';
    }
    return 'references_validated';
  });

  for (const conflict of result.reportedConflicts) {
    conflict.evidence.forEach(validateReference);
  }

  const validationStatus: AnalysisEvidenceValidationStatus =
    result.reportedConflicts.length > 0
      ? 'reported_conflicts'
      : result.findings.length === 0 ||
          findingStatuses.includes('insufficient_evidence')
        ? 'insufficient_evidence'
        : 'references_validated';

  return {
    result,
    validationStatus,
    findingStatuses,
    evidenceReferences: [...allReferences.values()].map((reference) => ({
      kind: reference.kind,
      id: reference.id,
      fieldPaths: [...reference.fieldPaths].sort(),
    })),
  };
}
