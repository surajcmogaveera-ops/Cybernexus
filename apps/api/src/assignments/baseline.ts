export const ASSIGNMENT_POLICY_VERSION = 'assignment-baseline-v1';

export type AssignmentIncident = {
  id: string;
  requiredSkills: readonly string[] | null;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'unclassified';
  deadlineAt: Date | null;
  createdAt: Date;
  currentAnalystIds?: readonly string[];
};

export type AssignmentAnalyst = {
  id: string;
  skills: readonly string[];
  availability: 'available' | 'unavailable';
  maxConcurrentAssignments: number | null;
  activeAssignments: number;
};

export type AssignmentDecision = {
  incidentId: string;
  analystId: string | null;
  status: 'assigned' | 'unassigned';
  reason: string;
  checks: {
    qualification: 'passed' | 'failed' | 'unknown';
    availability: 'passed' | 'failed';
    capacity: 'passed' | 'failed' | 'unknown';
  };
};

const priorityRank: Record<AssignmentIncident['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unclassified: 4,
};

/** Stable, greedy reference policy. Unknown qualifications/capacity never pass. */
export function createBaselineAssignmentPlan(
  incidents: readonly AssignmentIncident[],
  analysts: readonly AssignmentAnalyst[],
): AssignmentDecision[] {
  const orderedIncidents = [...incidents].sort(
    (left, right) =>
      priorityRank[left.priority] - priorityRank[right.priority] ||
      (left.deadlineAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.deadlineAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const workload = new Map(
    analysts.map((analyst) => [
      analyst.id,
      Math.max(
        0,
        analyst.activeAssignments -
          incidents.filter((incident) =>
            incident.currentAnalystIds?.includes(analyst.id),
          ).length,
      ),
    ]),
  );
  const plan: AssignmentDecision[] = [];

  for (const incident of orderedIncidents) {
    if (incident.requiredSkills === null) {
      plan.push({
        incidentId: incident.id,
        analystId: null,
        status: 'unassigned',
        reason: 'Required qualifications are unknown; assignment escalated.',
        checks: {
          qualification: 'unknown',
          availability: 'failed',
          capacity: 'unknown',
        },
      });
      continue;
    }

    const qualified = analysts.filter((analyst) =>
      incident.requiredSkills!.every((skill) => analyst.skills.includes(skill)),
    );
    const available = qualified.filter(
      (analyst) => analyst.availability === 'available',
    );
    const eligible = available.filter(
      (analyst) =>
        analyst.maxConcurrentAssignments !== null &&
        (workload.get(analyst.id) ?? analyst.activeAssignments) <
          analyst.maxConcurrentAssignments,
    );
    eligible.sort((left, right) => {
      const leftLoad = workload.get(left.id) ?? left.activeAssignments;
      const rightLoad = workload.get(right.id) ?? right.activeAssignments;
      const leftCapacity = left.maxConcurrentAssignments!;
      const rightCapacity = right.maxConcurrentAssignments!;
      return (
        leftLoad / leftCapacity - rightLoad / rightCapacity ||
        leftLoad - rightLoad ||
        left.id.localeCompare(right.id)
      );
    });
    const selected = eligible[0];
    if (selected) {
      workload.set(
        selected.id,
        (workload.get(selected.id) ?? selected.activeAssignments) + 1,
      );
      plan.push({
        incidentId: incident.id,
        analystId: selected.id,
        status: 'assigned',
        reason: `All required skills matched; analyst is available and within capacity (${workload.get(selected.id)}/${selected.maxConcurrentAssignments}). Workload ratio, active load, then analyst ID determined the tie-break.`,
        checks: {
          qualification: 'passed',
          availability: 'passed',
          capacity: 'passed',
        },
      });
      continue;
    }
    const reason =
      qualified.length === 0
        ? 'No analyst has every required skill.'
        : available.length === 0
          ? 'No qualified analyst is currently available.'
          : available.some(
                (analyst) => analyst.maxConcurrentAssignments === null,
              )
            ? 'Qualified analyst capacity is unknown; assignment escalated.'
            : 'All qualified available analysts are at capacity.';
    plan.push({
      incidentId: incident.id,
      analystId: null,
      status: 'unassigned',
      reason,
      checks: {
        qualification: qualified.length ? 'passed' : 'failed',
        availability: available.length ? 'passed' : 'failed',
        capacity: available.some(
          (analyst) => analyst.maxConcurrentAssignments === null,
        )
          ? 'unknown'
          : 'failed',
      },
    });
  }
  return plan;
}

/** Independently checks candidate output against the same snapshot's hard constraints. */
export function validateAssignmentPlan(
  incidents: readonly AssignmentIncident[],
  analysts: readonly AssignmentAnalyst[],
  plan: readonly AssignmentDecision[],
): string[] {
  const errors: string[] = [];
  const incidentById = new Map(
    incidents.map((incident) => [incident.id, incident]),
  );
  const analystById = new Map(analysts.map((analyst) => [analyst.id, analyst]));
  const assignmentsByAnalyst = new Map<string, number>();
  const seenIncidents = new Set<string>();

  for (const decision of plan) {
    const incident = incidentById.get(decision.incidentId);
    if (!incident) {
      errors.push(`Unknown incident ${decision.incidentId}.`);
      continue;
    }
    if (seenIncidents.has(decision.incidentId)) {
      errors.push(`Incident ${decision.incidentId} appears more than once.`);
      continue;
    }
    seenIncidents.add(decision.incidentId);
    if (decision.status === 'unassigned') {
      if (decision.analystId !== null)
        errors.push(
          `Unassigned incident ${decision.incidentId} has an analyst.`,
        );
      continue;
    }
    if (!decision.analystId) {
      errors.push(`Assigned incident ${decision.incidentId} has no analyst.`);
      continue;
    }
    const analyst = analystById.get(decision.analystId);
    if (!analyst) {
      errors.push(`Unknown analyst ${decision.analystId}.`);
      continue;
    }
    if (incident.requiredSkills === null)
      errors.push(`Incident ${incident.id} has unknown required skills.`);
    else if (
      !incident.requiredSkills.every((skill) => analyst.skills.includes(skill))
    )
      errors.push(
        `Analyst ${analyst.id} does not meet incident ${incident.id} skill requirements.`,
      );
    if (analyst.availability !== 'available')
      errors.push(`Analyst ${analyst.id} is unavailable.`);
    if (analyst.maxConcurrentAssignments === null)
      errors.push(`Analyst ${analyst.id} has unknown capacity.`);
    assignmentsByAnalyst.set(
      analyst.id,
      (assignmentsByAnalyst.get(analyst.id) ?? 0) + 1,
    );
  }
  for (const incident of incidents) {
    if (!seenIncidents.has(incident.id))
      errors.push(`Incident ${incident.id} is missing from the plan.`);
  }
  for (const analyst of analysts) {
    const planned = assignmentsByAnalyst.get(analyst.id) ?? 0;
    const outsideWorkload = Math.max(
      0,
      analyst.activeAssignments -
        incidents.filter((incident) =>
          incident.currentAnalystIds?.includes(analyst.id),
        ).length,
    );
    if (
      analyst.maxConcurrentAssignments !== null &&
      outsideWorkload + planned > analyst.maxConcurrentAssignments
    ) {
      errors.push(`Analyst ${analyst.id} capacity would be exceeded.`);
    }
  }
  return errors;
}

export function compareAssignmentPlans(
  baseline: readonly AssignmentDecision[],
  candidate: readonly AssignmentDecision[],
) {
  const byIncident = new Map(candidate.map((item) => [item.incidentId, item]));
  const comparable = baseline.filter((item) => byIncident.has(item.incidentId));
  const candidateById = new Map(
    comparable.map((item) => [
      item.incidentId,
      byIncident.get(item.incidentId)!,
    ]),
  );
  const assignedCount = (items: readonly AssignmentDecision[]) =>
    items.filter((item) => item.status === 'assigned').length;
  return {
    incidentCount: comparable.length,
    baselineCoverage: comparable.length
      ? assignedCount(comparable) / comparable.length
      : 0,
    candidateCoverage: comparable.length
      ? assignedCount([...candidateById.values()]) / comparable.length
      : 0,
    changedAssignments: comparable
      .filter(
        (item) =>
          item.analystId !== candidateById.get(item.incidentId)?.analystId,
      )
      .map((item) => ({
        incidentId: item.incidentId,
        baselineAnalystId: item.analystId,
        candidateAnalystId: candidateById.get(item.incidentId)!.analystId,
      })),
  };
}
