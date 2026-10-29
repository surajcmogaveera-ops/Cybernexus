import {
  IncidentAnalysisResultSchema,
  type IncidentAnalysisRequest,
  type IncidentAnalysisResult,
} from '@cybernexus/shared';

const severityOrder = [
  'unknown',
  'informational',
  'low',
  'medium',
  'high',
  'critical',
] as const;

/** Bounded metadata-only fallback used when the private FastAPI service is down. */
export function createDeterministicFallback(
  request: IncidentAnalysisRequest,
): IncidentAnalysisResult {
  const counts = new Map<string, number>();
  for (const alert of request.alerts) {
    counts.set(alert.severity, (counts.get(alert.severity) ?? 0) + 1);
  }
  const severitySummary = severityOrder
    .filter((severity) => (counts.get(severity) ?? 0) > 0)
    .map((severity) => `${counts.get(severity)} ${severity}`)
    .join(', ');
  const proposedSeverity = request.alerts.reduce(
    (highest, alert) =>
      severityOrder.indexOf(alert.severity) > severityOrder.indexOf(highest)
        ? alert.severity
        : highest,
    'unknown' as (typeof severityOrder)[number],
  );
  const totalRecords = request.alerts.length + request.relationships.length;
  const alertReferences = request.alerts.slice(0, 20).map(({ id }) => ({
    kind: 'alert' as const,
    id,
    fieldPaths: ['severity', 'observedAt'],
  }));
  const relationshipReferences = request.relationships
    .slice(0, 20)
    .map(({ id }) => ({
      kind: 'relationship' as const,
      id,
      fieldPaths: ['status', 'relationshipType', 'confidence'],
    }));

  const findings: IncidentAnalysisResult['findings'] = [
    {
      conclusion: `The linked source records contain ${request.alerts.length} alerts with source-reported severity values: ${severitySummary}.`,
      rationale:
        'This is a count of stored severity and event-time fields. It does not establish alert accuracy, intent, or causation.',
      evidence: alertReferences,
      confidence: alertReferences.length / totalRecords,
      uncertainty:
        'Source payloads and alert titles were not interpreted by this deterministic fallback.',
      verificationStatus: 'unverified',
    },
  ];

  if (request.relationships.length > 0) {
    const requiringReview = request.relationships.filter(
      ({ status }) => status === 'review_required',
    ).length;
    findings.push({
      conclusion: `The incident has ${request.relationships.length} persisted candidate relationship ${request.relationships.length === 1 ? 'record' : 'records'}; ${requiringReview} ${requiringReview === 1 ? 'requires' : 'require'} analyst review.`,
      rationale:
        'Relationship records describe hypotheses. They do not confirm an attack path or causal connection.',
      evidence: relationshipReferences,
      confidence: relationshipReferences.length / totalRecords,
      uncertainty:
        'The fallback does not independently resolve or semantically verify relationship explanations.',
      verificationStatus: 'unverified',
    });
  }

  const citedRecords = new Set([
    ...alertReferences.map(({ id }) => `alert:${id}`),
    ...relationshipReferences.map(({ id }) => `relationship:${id}`),
  ]).size;
  const hasReviewRequired = request.relationships.some(
    ({ status }) => status === 'review_required',
  );
  const alertOverflow = request.alerts.length > alertReferences.length;
  const relationshipOverflow =
    request.relationships.length > relationshipReferences.length;

  return IncidentAnalysisResultSchema.parse({
    contractVersion: 'v1',
    requestId: request.requestId,
    analysisMethod: 'deterministic_fallback',
    summary: `Deterministic fallback summarized ${request.alerts.length} persisted alert records (${severitySummary}). No causal or threat conclusion was made.`,
    proposedSeverity:
      proposedSeverity === 'unknown'
        ? request.incidentSeverity
        : proposedSeverity,
    analysisConfidence: citedRecords / totalRecords,
    findings,
    missingInformation: [
      'Raw payload contents and title text were excluded from fallback interpretation.',
      'Alert intent, accuracy, and causality were not determined.',
      ...(alertOverflow || relationshipOverflow
        ? [
            'Some source records were omitted from finding references to respect the contract limit.',
          ]
        : []),
      ...(hasReviewRequired
        ? [
            'One or more candidate relationships remain unresolved for analyst review.',
          ]
        : []),
    ],
    reportedConflicts: hasReviewRequired
      ? [
          {
            description:
              'One or more candidate relationships remain review-required; this is unresolved ambiguity, not confirmed contradictory evidence.',
            evidence: relationshipReferences,
          },
        ]
      : [],
    recommendedNextSteps: [
      'Review the original alert records and their source context.',
      'Validate or reject candidate relationships using approved evidence.',
    ],
    needsHumanReview: true,
    humanReviewRationale:
      'This fallback performs bounded metadata summarization only; it does not validate semantic claims or source accuracy.',
  });
}
