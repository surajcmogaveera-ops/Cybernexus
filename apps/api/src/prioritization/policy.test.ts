import { describe, expect, it } from 'vitest';
import {
  calculatePriority,
  calculateSla,
  createResponsePlan,
  estimateBreachRisk,
} from './policy.js';

const incidentId = '9a005f9a-1253-4ed7-8ae7-2d04da15e688';
const alertId = '15a3a4d2-59ba-4170-a25b-5b7ef3f71cb6';
const relationId = '8e7ea4eb-0e7a-4620-9f6b-98abc95fb09b';
const referenceAt = new Date('2026-10-29T12:00:00.000Z');

function input(severity = 'high') {
  return {
    id: incidentId,
    severity,
    createdAt: referenceAt,
    resolvedAt: null,
    closedAt: null,
    alerts: [{ id: alertId }],
    relationships: [],
    analysisConfidence: 0.2,
    priorityOverride: null,
    priorityOverrideReason: null,
  };
}

describe('deterministic priority, SLA, and response-plan policy', () => {
  it.each([
    ['critical', 70, 'high'],
    ['high', 55, 'medium'],
    ['medium', 40, 'medium'],
    ['low', 25, 'low'],
    ['informational', 10, 'low'],
  ])(
    'scores %s severity from its distinct policy base',
    (severity, score, priority) => {
      const result = calculatePriority(input(severity), referenceAt).response;
      expect(result).toMatchObject({
        severity,
        riskScore: score,
        recommendedPriority: priority,
        analysisConfidence: 0.2,
      });
      expect(result.factors.map(({ factor }) => factor)).toContain(
        'severity_base',
      );
    },
  );

  it('is deterministic, explains convergence and SLA factors, and does not score analysis confidence', () => {
    const enriched = {
      ...input(),
      createdAt: new Date(referenceAt.getTime() - 4 * 60 * 60_000),
      alerts: [{ id: alertId }, { id: relationId }, { id: incidentId }],
      relationships: [
        { id: relationId, status: 'accepted' },
        { id: incidentId, status: 'review_required' },
      ],
    };
    const first = calculatePriority(enriched, referenceAt).response;
    const second = calculatePriority(enriched, referenceAt).response;
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      riskScore: 90,
      recommendedPriority: 'critical',
    });
    expect(first.factors.map(({ points }) => points)).toEqual([
      55, 5, 10, 5, 15,
    ]);
    expect(
      calculatePriority({ ...enriched, analysisConfidence: 0.99 }, referenceAt)
        .response.riskScore,
    ).toBe(first.riskScore);
  });

  it('classifies exact priority boundaries and applies a 50% remaining-time factor', () => {
    const highBoundary = calculatePriority(
      {
        ...input('high'),
        relationships: [{ id: relationId, status: 'accepted' }],
      },
      referenceAt,
    ).response;
    expect(highBoundary.riskScore).toBe(65);
    expect(highBoundary.recommendedPriority).toBe('high');

    const criticalBoundary = calculatePriority(
      {
        ...input('critical'),
        relationships: [
          { id: relationId, status: 'accepted' },
          { id: alertId, status: 'proposed' },
        ],
      },
      referenceAt,
    ).response;
    expect(criticalBoundary.riskScore).toBe(85);
    expect(criticalBoundary.recommendedPriority).toBe('critical');

    const highBelowCritical = calculatePriority(
      {
        ...input('critical'),
        relationships: [{ id: relationId, status: 'accepted' }],
      },
      referenceAt,
    ).response;
    expect(highBelowCritical).toMatchObject({
      riskScore: 80,
      recommendedPriority: 'high',
    });

    const mediumBelowHigh = calculatePriority(
      {
        ...input('high'),
        relationships: [{ id: relationId, status: 'review_required' }],
      },
      referenceAt,
    ).response;
    expect(mediumBelowHigh).toMatchObject({
      riskScore: 60,
      recommendedPriority: 'medium',
    });

    const lowBelowMedium = calculatePriority(
      {
        ...input('low'),
        relationships: [{ id: relationId, status: 'accepted' }],
      },
      referenceAt,
    ).response;
    expect(lowBelowMedium).toMatchObject({
      riskScore: 35,
      recommendedPriority: 'low',
    });

    const halfTime = calculatePriority(
      {
        ...input('high'),
        createdAt: new Date(referenceAt.getTime() - 2 * 60 * 60_000),
      },
      referenceAt,
    ).response;
    expect(
      halfTime.factors.find(({ factor }) => factor === 'deadline_urgency')
        ?.points,
    ).toBe(5);
  });

  it('withholds numeric risk when severity is unknown and marks the deadline unknown', () => {
    const result = calculatePriority(input('unknown'), referenceAt);
    expect(result.response).toMatchObject({
      riskScore: null,
      recommendedPriority: 'unclassified',
      unavailableInputs: expect.arrayContaining([
        'Incident severity is unknown, so no numeric score is issued.',
      ]),
    });
    expect(result.sla.state).toBe('deadline_unknown');
  });

  it('classifies UTC deadlines at exact approach, overdue, and completion boundaries', () => {
    const highTarget = 4 * 60 * 60_000;
    const atApproach = calculateSla(
      {
        ...input(),
        createdAt: new Date(referenceAt.getTime() - highTarget * 0.75),
      },
      referenceAt,
    );
    expect(atApproach.state).toBe('approaching_deadline');
    const justOutsideApproach = calculateSla(
      {
        ...input(),
        createdAt: new Date(referenceAt.getTime() - highTarget * 0.749),
      },
      referenceAt,
    );
    expect(justOutsideApproach.state).toBe('on_track');
    const overdue = calculateSla(
      {
        ...input(),
        createdAt: new Date(referenceAt.getTime() - highTarget - 1),
      },
      referenceAt,
    );
    expect(overdue.state).toBe('overdue');
    const exactlyAtDeadline = calculateSla(
      {
        ...input(),
        createdAt: new Date(referenceAt.getTime() - highTarget),
      },
      referenceAt,
    );
    expect(exactlyAtDeadline).toMatchObject({
      remainingMinutes: 0,
      state: 'overdue',
    });
    const met = calculateSla(
      {
        ...input(),
        createdAt: new Date(referenceAt.getTime() - highTarget * 2),
        resolvedAt: new Date(referenceAt.getTime() - highTarget),
      },
      referenceAt,
    );
    expect(met.state).toBe('met');
    const breached = calculateSla(
      {
        ...input(),
        createdAt: new Date(referenceAt.getTime() - highTarget * 2),
        resolvedAt: new Date(referenceAt.getTime() - highTarget + 1),
      },
      referenceAt,
    );
    expect(breached.state).toBe('breached');
  });

  it('uses the injected reference time and returns an explicit deadline for known severity', () => {
    const incident = input('critical');
    const onTrack = calculateSla(incident, referenceAt);
    const later = calculateSla(
      incident,
      new Date(referenceAt.getTime() + 45 * 60_000),
    );
    expect(onTrack.deadlineAt).toBe('2026-10-29T13:00:00.000Z');
    expect(onTrack.state).toBe('on_track');
    expect(later.state).toBe('approaching_deadline');

    const timezoneOffset = calculateSla(
      {
        ...input('high'),
        createdAt: new Date('2026-10-29T17:30:00+05:30'),
      },
      referenceAt,
    );
    expect(timezoneOffset.deadlineAt).toBe('2026-10-29T16:00:00.000Z');
  });

  it('keeps the SLA target visible when creation time is invalid and rejects an invalid reference time', () => {
    const invalidCreatedAt = calculateSla(
      { ...input(), createdAt: new Date(Number.NaN) },
      referenceAt,
    );
    expect(invalidCreatedAt).toMatchObject({
      responseTargetMinutes: 240,
      deadlineAt: null,
      state: 'deadline_unknown',
    });
    expect(() => calculateSla(input(), new Date(Number.NaN))).toThrow(
      'SLA reference time must be a valid UTC instant.',
    );
    expect(() =>
      calculateSla(
        { ...input(), resolvedAt: new Date(Number.NaN) },
        referenceAt,
      ),
    ).toThrow('SLA completion time must be a valid UTC instant.');
  });

  it('treats malformed and prototype-named severity values as unknown', () => {
    const result = calculatePriority(input('toString'), referenceAt);
    expect(result.response).toMatchObject({
      severity: 'unknown',
      riskScore: null,
      recommendedPriority: 'unclassified',
    });
    expect(result.sla).toMatchObject({
      responseTargetMinutes: null,
      state: 'deadline_unknown',
    });
  });

  it('returns transparent breach bands without claiming a predictive model', () => {
    const calculated = calculatePriority(input(), referenceAt);
    expect(
      estimateBreachRisk(incidentId, calculated.response, calculated.sla),
    ).toMatchObject({
      band: 'low',
      predictiveModel: false,
    });
    const unknown = calculatePriority(input('unknown'), referenceAt);
    expect(
      estimateBreachRisk(incidentId, unknown.response, unknown.sla).band,
    ).toBe('unknown');
    const approaching = calculatePriority(
      {
        ...input('critical'),
        createdAt: new Date(referenceAt.getTime() - 45 * 60_000),
      },
      referenceAt,
    );
    expect(
      estimateBreachRisk(incidentId, approaching.response, approaching.sla)
        .band,
    ).toBe('high');
  });

  it('grounds response recommendations in actual records and keeps them unperformed', () => {
    const plan = createResponsePlan(
      incidentId,
      'medium',
      [{ id: alertId }],
      [{ id: relationId, status: 'review_required' }],
      referenceAt,
    );
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({
      status: 'suggested',
      approvalStatus: 'review_required',
      performed: false,
      evidence: [{ kind: 'alert', id: alertId }],
    });
    expect(plan.steps[1]!.evidence).toEqual([
      { kind: 'relationship', id: relationId },
    ]);
  });

  it('uses supported alert categories and high severity only to suggest reviewed steps', () => {
    const plan = createResponsePlan(
      incidentId,
      'high',
      [{ id: alertId, alertType: 'authentication' }],
      [],
      referenceAt,
    );
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1]).toMatchObject({
      action:
        'Validate authentication events with the identity provider records.',
      evidence: [{ kind: 'alert', id: alertId }],
      performed: false,
    });
    expect(plan.steps[2]!.action).toContain('response playbook');
    expect(
      plan.steps.every(
        ({ status, approvalStatus, performed }) =>
          status === 'suggested' &&
          approvalStatus === 'review_required' &&
          !performed,
      ),
    ).toBe(true);
  });

  it('creates a separate evidence-scoped suggestion for each supported category and ignores unsupported types', () => {
    const secondAlertId = '10000000-0000-4000-8000-000000000099';
    const thirdAlertId = '10000000-0000-4000-8000-000000000100';
    const plan = createResponsePlan(
      incidentId,
      'medium',
      [
        { id: alertId, alertType: 'authentication' },
        { id: secondAlertId, alertType: 'dns-anomaly' },
        { id: thirdAlertId, alertType: 'untrusted-category' },
      ],
      [],
      referenceAt,
    );
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1]).toMatchObject({
      action:
        'Validate authentication events with the identity provider records.',
      evidence: [{ kind: 'alert', id: alertId }],
      approvalStatus: 'review_required',
      performed: false,
    });
    expect(plan.steps[2]).toMatchObject({
      action:
        'Validate DNS observations against resolver logs and approved network context.',
      evidence: [{ kind: 'alert', id: secondAlertId }],
      approvalStatus: 'review_required',
      performed: false,
    });
    expect(
      plan.steps
        .flatMap(({ evidence }) => evidence)
        .some(({ id }) => id === thirdAlertId),
    ).toBe(true);
    expect(plan.steps.map(({ order }) => order)).toEqual([1, 2, 3]);
  });

  it.each(['untrusted-category', 'toString', 'constructor'])(
    'falls back to source validation for unsupported alert category %s',
    (alertType) => {
      const plan = createResponsePlan(
        incidentId,
        'medium',
        [{ id: alertId, alertType }],
        [],
        referenceAt,
      );
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]).toMatchObject({
        action:
          'Review source records and validate the original events with their originating systems.',
        evidence: [{ kind: 'alert', id: alertId }],
        status: 'suggested',
        approvalStatus: 'review_required',
        performed: false,
      });
    },
  );
});
