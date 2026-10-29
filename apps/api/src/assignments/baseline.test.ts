import { describe, expect, it } from 'vitest';
import {
  compareAssignmentPlans,
  createBaselineAssignmentPlan,
  validateAssignmentPlan,
} from './baseline.js';

const analysts = [
  {
    id: 'b',
    skills: ['identity'],
    availability: 'available' as const,
    maxConcurrentAssignments: 1,
    activeAssignments: 0,
  },
  {
    id: 'a',
    skills: ['identity'],
    availability: 'available' as const,
    maxConcurrentAssignments: 1,
    activeAssignments: 0,
  },
  {
    id: 'c',
    skills: ['identity'],
    availability: 'unavailable' as const,
    maxConcurrentAssignments: 5,
    activeAssignments: 0,
  },
];
const incidents = [
  {
    id: 'later',
    requiredSkills: ['identity'],
    priority: 'medium' as const,
    deadlineAt: null,
    createdAt: new Date('2026-01-02T00:00:00Z'),
  },
  {
    id: 'first',
    requiredSkills: ['identity'],
    priority: 'critical' as const,
    deadlineAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-02T00:00:00Z'),
  },
  {
    id: 'unknown',
    requiredSkills: null,
    priority: 'high' as const,
    deadlineAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
];

describe('deterministic assignment baseline', () => {
  it('orders by priority, respects qualifications, availability and capacity, and is repeatable', () => {
    const result = createBaselineAssignmentPlan(incidents, analysts);
    expect(result).toEqual(createBaselineAssignmentPlan(incidents, analysts));
    expect(result.map(({ incidentId }) => incidentId)).toEqual([
      'first',
      'unknown',
      'later',
    ]);
    expect(result[0]).toMatchObject({ analystId: 'a', status: 'assigned' });
    expect(result[1]).toMatchObject({
      status: 'unassigned',
      checks: { qualification: 'unknown' },
    });
    expect(result[2]).toMatchObject({ status: 'assigned', analystId: 'b' });
    expect(result.some(({ analystId }) => analystId === 'c')).toBe(false);
  });

  it('escalates when no qualified analyst has capacity', () => {
    const plan = createBaselineAssignmentPlan(
      [{ ...incidents[0]!, id: 'full' }],
      [{ ...analysts[0]!, activeAssignments: 1 }],
    );
    expect(plan[0]).toMatchObject({
      status: 'unassigned',
      reason: 'All qualified available analysts are at capacity.',
    });
  });

  it('never treats unknown capacity or missing qualifications as feasible', () => {
    const unknownCapacity = createBaselineAssignmentPlan(
      [{ ...incidents[0]!, id: 'unknown-capacity' }],
      [{ ...analysts[0]!, maxConcurrentAssignments: null }],
    );
    const unqualified = createBaselineAssignmentPlan(
      [{ ...incidents[0]!, id: 'unqualified', requiredSkills: ['forensics'] }],
      analysts,
    );
    expect(unknownCapacity[0]).toMatchObject({
      status: 'unassigned',
      checks: { capacity: 'unknown' },
    });
    expect(unqualified[0]).toMatchObject({
      status: 'unassigned',
      checks: { qualification: 'failed' },
    });
  });

  it('compares plans over the same incident IDs', () => {
    const baseline = createBaselineAssignmentPlan([incidents[0]!], analysts);
    const alternate = [{ ...baseline[0]!, analystId: 'b' }];
    expect(compareAssignmentPlans(baseline, alternate)).toMatchObject({
      incidentCount: 1,
      baselineCoverage: 1,
      candidateCoverage: 1,
      changedAssignments: [
        {
          incidentId: 'later',
          baselineAnalystId: 'a',
          candidateAnalystId: 'b',
        },
      ],
    });
  });

  it('measures a feasible synthetic alternative against a constrained baseline', () => {
    const scenarioAnalysts = [
      {
        id: 'a-flex',
        skills: ['identity', 'forensics'],
        availability: 'available' as const,
        maxConcurrentAssignments: 1,
        activeAssignments: 0,
      },
      {
        id: 'b-identity',
        skills: ['identity'],
        availability: 'available' as const,
        maxConcurrentAssignments: 1,
        activeAssignments: 0,
      },
    ];
    const scenarioIncidents = [
      {
        id: 'identity-alert',
        requiredSkills: ['identity'],
        priority: 'critical' as const,
        deadlineAt: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
      {
        id: 'forensics-alert',
        requiredSkills: ['forensics'],
        priority: 'high' as const,
        deadlineAt: null,
        createdAt: new Date('2026-10-01T00:01:00Z'),
      },
    ];
    const baseline = createBaselineAssignmentPlan(
      scenarioIncidents,
      scenarioAnalysts,
    );
    const feasibleAlternative = [
      { ...baseline[0]!, analystId: 'b-identity', status: 'assigned' as const },
      {
        ...baseline[1]!,
        analystId: 'a-flex',
        status: 'assigned' as const,
      },
    ];

    expect(
      validateAssignmentPlan(
        scenarioIncidents,
        scenarioAnalysts,
        feasibleAlternative,
      ),
    ).toEqual([]);
    expect(compareAssignmentPlans(baseline, feasibleAlternative)).toMatchObject(
      {
        incidentCount: 2,
        baselineCoverage: 0.5,
        candidateCoverage: 1,
      },
    );
  });

  it('independently rejects candidate results that violate hard constraints', () => {
    const invalid = [
      {
        incidentId: 'first',
        analystId: 'c',
        status: 'assigned' as const,
        reason: 'invalid candidate',
        checks: {
          qualification: 'passed' as const,
          availability: 'passed' as const,
          capacity: 'passed' as const,
        },
      },
      {
        incidentId: 'unknown',
        analystId: 'c',
        status: 'assigned' as const,
        reason: 'unknown skills',
        checks: {
          qualification: 'passed' as const,
          availability: 'passed' as const,
          capacity: 'passed' as const,
        },
      },
      {
        incidentId: 'later',
        analystId: 'missing',
        status: 'assigned' as const,
        reason: 'unknown analyst',
        checks: {
          qualification: 'passed' as const,
          availability: 'passed' as const,
          capacity: 'passed' as const,
        },
      },
    ];
    const errors = validateAssignmentPlan(incidents, analysts, invalid);
    expect(errors).toContain('Analyst c is unavailable.');
    expect(errors).toContain('Incident unknown has unknown required skills.');
    expect(errors).toContain('Unknown analyst missing.');
  });
});
