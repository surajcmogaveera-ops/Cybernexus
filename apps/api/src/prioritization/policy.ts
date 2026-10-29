import {
  IncidentBreachRiskResponseSchema,
  IncidentPriorityResponseSchema,
  IncidentResponsePlanSchema,
  IncidentSlaResponseSchema,
  type IncidentPriority,
  type IncidentPriorityResponse,
  type IncidentResponsePlan,
  type IncidentSlaResponse,
  type BreachRiskBand,
  type PriorityFactor,
} from '@cybernexus/shared';

export const PRIORITY_POLICY_VERSION = 'risk-v1';
export const SLA_POLICY_VERSION = 'response-sla-v1';
export const APPROACHING_THRESHOLD_PERCENT = 25;

const severityBase: Record<string, number | null> = {
  critical: 70,
  high: 55,
  medium: 40,
  low: 25,
  informational: 10,
  unknown: null,
};

const responseTargetMinutes: Record<string, number | null> = {
  critical: 60,
  high: 240,
  medium: 1_440,
  low: 4_320,
  informational: 10_080,
  unknown: null,
};

export type PrioritizationInput = {
  id: string;
  severity: string;
  createdAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  alerts: { id: string; alertType?: string | null }[];
  relationships: { id: string; status: string }[];
  analysisConfidence: number | null;
  priorityOverride: string | null;
  priorityOverrideReason: string | null;
};

export type SlaSnapshot = IncidentSlaResponse & {
  targetMilliseconds: number | null;
  remainingMilliseconds: number | null;
};

export function calculateSla(
  incident: Pick<
    PrioritizationInput,
    'id' | 'severity' | 'createdAt' | 'resolvedAt' | 'closedAt'
  >,
  referenceAt: Date,
): SlaSnapshot {
  const severity = Object.hasOwn(severityBase, incident.severity)
    ? incident.severity
    : 'unknown';
  const targetMinutes = responseTargetMinutes[severity] ?? null;
  if (!Number.isFinite(referenceAt.getTime())) {
    throw new RangeError('SLA reference time must be a valid UTC instant.');
  }
  if (
    [incident.resolvedAt, incident.closedAt].some(
      (completedAt) =>
        completedAt !== null && !Number.isFinite(completedAt.getTime()),
    )
  ) {
    throw new RangeError('SLA completion time must be a valid UTC instant.');
  }
  if (
    !Number.isFinite(incident.createdAt.getTime()) ||
    targetMinutes === null
  ) {
    return {
      ...IncidentSlaResponseSchema.parse({
        incidentId: incident.id,
        policyVersion: SLA_POLICY_VERSION,
        responseTargetMinutes: targetMinutes,
        referenceAt: referenceAt.toISOString(),
        deadlineAt: null,
        remainingMinutes: null,
        approachingThresholdPercent: APPROACHING_THRESHOLD_PERCENT,
        state: 'deadline_unknown',
        explanation:
          targetMinutes === null
            ? 'No response target is defined for the current severity.'
            : 'The incident creation time is unavailable, so the deadline cannot be calculated.',
      }),
      targetMilliseconds:
        targetMinutes === null ? null : targetMinutes * 60_000,
      remainingMilliseconds: null,
    };
  }

  const targetMilliseconds = targetMinutes * 60_000;
  const deadline = new Date(incident.createdAt.getTime() + targetMilliseconds);
  const remainingMilliseconds = deadline.getTime() - referenceAt.getTime();
  const completedAt = incident.resolvedAt ?? incident.closedAt;
  const state = completedAt
    ? completedAt.getTime() <= deadline.getTime()
      ? 'met'
      : 'breached'
    : remainingMilliseconds <= 0
      ? 'overdue'
      : remainingMilliseconds <=
          (targetMilliseconds * APPROACHING_THRESHOLD_PERCENT) / 100
        ? 'approaching_deadline'
        : 'on_track';
  const explanation = {
    on_track: 'More than 25% of the response target remains.',
    approaching_deadline: '25% or less of the response target remains.',
    overdue:
      'The response deadline passed while the incident remains unresolved.',
    met: 'The incident was resolved or closed by its response deadline.',
    breached:
      'The incident was resolved or closed after its response deadline.',
    deadline_unknown: 'The response deadline is unavailable.',
  }[state];

  return {
    ...IncidentSlaResponseSchema.parse({
      incidentId: incident.id,
      policyVersion: SLA_POLICY_VERSION,
      responseTargetMinutes: targetMinutes,
      referenceAt: referenceAt.toISOString(),
      deadlineAt: deadline.toISOString(),
      remainingMinutes:
        remainingMilliseconds >= 0
          ? Math.ceil(remainingMilliseconds / 60_000)
          : Math.floor(remainingMilliseconds / 60_000),
      approachingThresholdPercent: APPROACHING_THRESHOLD_PERCENT,
      state,
      explanation,
    }),
    targetMilliseconds,
    remainingMilliseconds,
  };
}

function classificationFor(score: number | null): IncidentPriority {
  if (score === null) return 'unclassified';
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function calculatePriority(
  incident: PrioritizationInput,
  referenceAt: Date,
): {
  response: IncidentPriorityResponse;
  sla: SlaSnapshot;
  inputs: Record<string, unknown>;
} {
  const severity = Object.hasOwn(severityBase, incident.severity)
    ? incident.severity
    : 'unknown';
  const sla = calculateSla(incident, referenceAt);
  const base = severityBase[severity] ?? null;
  const acceptedCount = incident.relationships.filter(
    ({ status }) => status === 'accepted',
  ).length;
  const reviewCount = incident.relationships.filter(
    ({ status }) => status === 'review_required' || status === 'proposed',
  ).length;
  const urgencyPoints =
    sla.state === 'overdue' || sla.state === 'breached'
      ? 15
      : sla.state === 'approaching_deadline'
        ? 10
        : sla.targetMilliseconds !== null &&
            sla.remainingMilliseconds !== null &&
            sla.remainingMilliseconds <= sla.targetMilliseconds * 0.5
          ? 5
          : 0;

  const factors: PriorityFactor[] =
    base === null
      ? [
          {
            factor: 'severity_base',
            points: null,
            explanation: 'Severity is unknown; a numeric score is withheld.',
          },
          {
            factor: 'alert_convergence',
            points: null,
            explanation: 'Not scored because severity is unknown.',
          },
          {
            factor: 'accepted_relationship',
            points: null,
            explanation: 'Not scored because severity is unknown.',
          },
          {
            factor: 'review_required_relationship',
            points: null,
            explanation: 'Not scored because severity is unknown.',
          },
          {
            factor: 'deadline_urgency',
            points: null,
            explanation: 'Not scored because severity is unknown.',
          },
        ]
      : [
          {
            factor: 'severity_base',
            points: base,
            explanation: `The ${severity} classification contributes the policy base score.`,
          },
          {
            factor: 'alert_convergence',
            points: incident.alerts.length >= 3 ? 5 : 0,
            explanation:
              incident.alerts.length >= 3
                ? 'Three or more linked alerts contribute 5 convergence points.'
                : 'Fewer than three linked alerts add no convergence points.',
          },
          {
            factor: 'accepted_relationship',
            points: acceptedCount > 0 ? 10 : 0,
            explanation:
              acceptedCount > 0
                ? 'At least one analyst-accepted relationship contributes 10 points.'
                : 'No analyst-accepted relationship contributes points.',
          },
          {
            factor: 'review_required_relationship',
            points: reviewCount > 0 ? 5 : 0,
            explanation:
              reviewCount > 0
                ? 'An unresolved proposed or review-required candidate contributes 5 caution points, not confirmation.'
                : 'No unresolved candidate contributes points.',
          },
          {
            factor: 'deadline_urgency',
            points: urgencyPoints,
            explanation:
              sla.state === 'deadline_unknown'
                ? 'No deadline urgency points are added because the target is unknown.'
                : `Current SLA state ${sla.state} contributes ${urgencyPoints} points.`,
          },
        ];
  const riskScore =
    base === null
      ? null
      : Math.min(
          100,
          factors.reduce((sum, factor) => sum + (factor.points ?? 0), 0),
        );
  const recommendedPriority = classificationFor(riskScore);
  const override = incident.priorityOverride as
    'critical' | 'high' | 'medium' | 'low' | null;
  const effectivePriority = override ?? recommendedPriority;
  const unavailableInputs = [
    'Asset criticality and business impact are not modeled.',
    'Assignment capacity and estimated effort are not modeled by risk-v1.',
    ...(severity === 'unknown'
      ? ['Incident severity is unknown, so no numeric score is issued.']
      : []),
  ];
  const response = IncidentPriorityResponseSchema.parse({
    incidentId: incident.id,
    severity,
    analysisConfidence: incident.analysisConfidence,
    policyVersion: PRIORITY_POLICY_VERSION,
    calculatedAt: referenceAt.toISOString(),
    riskScore,
    recommendedPriority,
    effectivePriority,
    priorityOverride: override,
    overrideReason: incident.priorityOverrideReason,
    factors,
    unavailableInputs,
  });

  return {
    response,
    sla,
    inputs: {
      severity,
      incidentCreatedAt: incident.createdAt.toISOString(),
      linkedAlertCount: incident.alerts.length,
      alertIds: incident.alerts.map(({ id }) => id),
      relationships: incident.relationships.map(({ id, status }) => ({
        id,
        status,
      })),
      analysisConfidence: incident.analysisConfidence,
      referenceAt: referenceAt.toISOString(),
      slaState: sla.state,
      unavailableInputs,
    },
  };
}

export function estimateBreachRisk(
  incidentId: string,
  priority: IncidentPriorityResponse,
  sla: IncidentSlaResponse,
) {
  let band: BreachRiskBand;
  let explanation: string;
  if (sla.state === 'deadline_unknown') {
    band = 'unknown';
    explanation =
      'A breach estimate is unavailable without a defined deadline.';
  } else if (sla.state === 'met' || sla.state === 'breached') {
    band = 'not_applicable';
    explanation =
      'The response deadline has already reached a measured outcome.';
  } else if (sla.state === 'overdue') {
    band = 'high';
    explanation =
      'The unresolved incident is already past its response deadline.';
  } else if (sla.state === 'approaching_deadline') {
    band = ['critical', 'high'].includes(priority.effectivePriority)
      ? 'high'
      : 'moderate';
    explanation = `The incident is approaching its deadline with ${priority.effectivePriority} effective priority.`;
  } else if (priority.effectivePriority === 'critical') {
    band = 'moderate';
    explanation =
      'Critical effective priority has more than 25% of its SLA remaining.';
  } else {
    band = 'low';
    explanation =
      'The incident is on track with no high-priority deadline rule triggered.';
  }
  return IncidentBreachRiskResponseSchema.parse({
    incidentId,
    policyVersion: 'breach-rules-v1',
    band,
    predictiveModel: false,
    explanation,
  });
}

export function createResponsePlan(
  incidentId: string,
  severity: string,
  alerts: { id: string; alertType?: string | null }[],
  relationships: { id: string; status: string }[],
  generatedAt: Date,
): IncidentResponsePlan {
  const steps: IncidentResponsePlan['steps'] = [];
  if (alerts.length) {
    steps.push({
      order: steps.length + 1,
      action:
        'Review source records and validate the original events with their originating systems.',
      rationale:
        'Prioritization uses recorded alert metadata and does not independently verify source accuracy.',
      evidence: alerts.slice(0, 20).map(({ id }) => ({ kind: 'alert', id })),
      status: 'suggested',
      approvalStatus: 'review_required',
      performed: false,
    });
  }
  const categoryActions: Record<string, { action: string; rationale: string }> =
    {
      authentication: {
        action:
          'Validate authentication events with the identity provider records.',
        rationale:
          'This alert category calls for source validation; the category does not establish an account compromise.',
      },
      'process-start': {
        action:
          'Validate process-start observations with the originating endpoint telemetry.',
        rationale:
          'This category describes process observations and does not itself establish malicious execution.',
      },
      'iam-policy-change': {
        action:
          'Review the IAM change record and its authorized change context.',
        rationale:
          'This category identifies a policy-change event; authorization is not inferred.',
      },
      'dns-anomaly': {
        action:
          'Validate DNS observations against resolver logs and approved network context.',
        rationale:
          'This category identifies an anomaly for review and does not establish maliciousness.',
      },
      'mfa-enrollment': {
        action:
          'Validate the MFA enrollment event with the identity provider and account owner.',
        rationale:
          'This category does not by itself establish account compromise.',
      },
      'user-report': {
        action:
          'Review the original report with its reporting channel and corroborating records.',
        rationale:
          'A user report is a source record and may need independent corroboration.',
      },
      'connection-observation': {
        action:
          'Validate connection observations with network flow and destination context.',
        rationale:
          'This recommendation does not classify the observed destination.',
      },
    };
  const supportedTypes = [
    ...new Set(
      alerts
        .map(({ alertType }) => alertType)
        .filter(
          (alertType): alertType is string =>
            typeof alertType === 'string' &&
            Object.hasOwn(categoryActions, alertType),
        ),
    ),
  ].sort();
  for (const supportedType of supportedTypes) {
    const category = categoryActions[supportedType]!;
    steps.push({
      order: steps.length + 1,
      action: category.action,
      rationale: category.rationale,
      evidence: alerts
        .filter(({ alertType }) => alertType === supportedType)
        .slice(0, 20)
        .map(({ id }) => ({ kind: 'alert', id })),
      status: 'suggested',
      approvalStatus: 'review_required',
      performed: false,
    });
  }
  const candidates = relationships.filter(
    ({ status }) => status === 'review_required' || status === 'proposed',
  );
  if (candidates.length) {
    steps.push({
      order: steps.length + 1,
      action:
        'Review candidate relationships and confirm or reject them using approved evidence.',
      rationale:
        'Candidate correlation edges are hypotheses and are not confirmed attack paths.',
      evidence: candidates
        .slice(0, 20)
        .map(({ id }) => ({ kind: 'relationship', id })),
      status: 'suggested',
      approvalStatus: 'review_required',
      performed: false,
    });
  }
  if (severity === 'critical' || severity === 'high') {
    steps.push({
      order: steps.length + 1,
      action:
        'Review the approved incident response playbook before any containment decision.',
      rationale: `Source severity is ${severity}; this suggestion does not authorize disruptive action.`,
      evidence: alerts.slice(0, 20).map(({ id }) => ({ kind: 'alert', id })),
      status: 'suggested',
      approvalStatus: 'review_required',
      performed: false,
    });
  }
  return IncidentResponsePlanSchema.parse({
    incidentId,
    generatedAt: generatedAt.toISOString(),
    steps,
  });
}
