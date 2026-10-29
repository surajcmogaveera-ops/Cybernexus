import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  IncidentPriorityOverrideResponseSchema,
  IncidentPriorityOverrideSchema,
  IncidentPriorityResponseSchema,
  IncidentResponsePlanSchema,
  IncidentSlaResponseSchema,
  type IncidentPriorityResponse,
  type IncidentPriorityOverrideResponse,
} from '@cybernexus/shared';
import { writeAuditEvent } from '../audit/write-audit-event.js';
import {
  calculatePriority,
  calculateSla,
  createResponsePlan,
  estimateBreachRisk,
  PRIORITY_POLICY_VERSION,
  type PrioritizationInput,
} from './policy.js';

export class PriorityIncidentNotFoundError extends Error {}
export class PriorityOverrideConflictError extends Error {}
export class PriorityCalculationNotFoundError extends Error {}

type LoadedIncident = {
  id: string;
  severity: string;
  createdAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date;
  priorityOverride: string | null;
  priorityOverrideReason: string | null;
  priorityOverrideActorId: string | null;
  priorityOverrideAt: Date | null;
  alertLinks: { alertId: string; alert: { alertType: string | null } }[];
  analyses: { analysisConfidence: number | null }[];
};

async function loadIncidentContext(
  database: PrismaClient,
  incidentId: string,
): Promise<{
  incident: LoadedIncident;
  input: PrioritizationInput;
  relationships: { id: string; status: string }[];
}> {
  const incident = (await database.incident.findUnique({
    where: { id: incidentId },
    include: {
      alertLinks: {
        select: { alertId: true, alert: { select: { alertType: true } } },
        orderBy: { alertId: 'asc' },
      },
      analyses: {
        where: { status: 'completed', analysisConfidence: { not: null } },
        select: { analysisConfidence: true },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take: 1,
      },
    },
  })) as LoadedIncident | null;
  if (!incident) throw new PriorityIncidentNotFoundError();
  const alertIds = incident.alertLinks.map(({ alertId }) => alertId);
  const relationships = alertIds.length
    ? await database.alertRelationship.findMany({
        where: {
          sourceAlertId: { in: alertIds },
          targetAlertId: { in: alertIds },
        },
        select: { id: true, status: true },
        orderBy: [{ id: 'asc' }],
      })
    : [];
  const input: PrioritizationInput = {
    id: incident.id,
    severity: incident.severity,
    createdAt: incident.createdAt,
    resolvedAt: incident.resolvedAt,
    closedAt: incident.closedAt,
    alerts: incident.alertLinks.map(({ alertId, alert }) => ({
      id: alertId,
      alertType: alert.alertType,
    })),
    relationships,
    analysisConfidence: incident.analyses[0]?.analysisConfidence ?? null,
    priorityOverride: incident.priorityOverride,
    priorityOverrideReason: incident.priorityOverrideReason,
  };
  return { incident, input, relationships };
}

export async function calculateAndPersistPriority(
  database: PrismaClient,
  incidentId: string,
  actorId: string,
  referenceAt = new Date(),
): Promise<IncidentPriorityResponse> {
  const { incident, input } = await loadIncidentContext(database, incidentId);
  const { response, sla, inputs } = calculatePriority(input, referenceAt);
  const stored = await database.$transaction(async (transaction) => {
    const calculation = await transaction.incidentPriorityCalculation.create({
      data: {
        id: randomUUID(),
        incidentId,
        policyVersion: PRIORITY_POLICY_VERSION,
        calculatedAt: referenceAt,
        riskScore: response.riskScore,
        recommendedPriority: response.recommendedPriority,
        slaState: sla.state,
        deadlineAt: sla.deadlineAt ? new Date(sla.deadlineAt) : null,
        inputs: inputs as Prisma.InputJsonValue,
        factors: response.factors as unknown as Prisma.InputJsonValue,
      },
    });
    await writeAuditEvent(transaction, {
      eventType: 'incident.priority.calculated',
      targetType: 'Incident',
      targetId: incidentId,
      actorId,
      metadata: {
        policyVersion: PRIORITY_POLICY_VERSION,
        calculationId: calculation.id,
        riskScore: response.riskScore,
        recommendedPriority: response.recommendedPriority,
        slaState: sla.state,
      },
    });
    return calculation;
  });
  return priorityFromStored(stored, incident);
}

export async function getLatestPriority(
  database: PrismaClient,
  incidentId: string,
): Promise<IncidentPriorityResponse> {
  const { incident } = await loadIncidentContext(database, incidentId);
  const calculation = await database.incidentPriorityCalculation.findFirst({
    where: { incidentId },
    orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
  });
  if (!calculation) throw new PriorityCalculationNotFoundError();
  return priorityFromStored(calculation, incident);
}

function priorityFromStored(
  calculation: {
    id: string;
    policyVersion: string;
    calculatedAt: Date;
    riskScore: number | null;
    recommendedPriority: string;
    inputs: Prisma.JsonValue;
    factors: Prisma.JsonValue;
  },
  incident: LoadedIncident,
): IncidentPriorityResponse {
  const input = calculation.inputs as Record<string, unknown>;
  return IncidentPriorityResponseSchema.parse({
    incidentId: incident.id,
    severity: input.severity,
    analysisConfidence: input.analysisConfidence,
    policyVersion: calculation.policyVersion,
    calculatedAt: calculation.calculatedAt.toISOString(),
    riskScore: calculation.riskScore,
    recommendedPriority: calculation.recommendedPriority,
    effectivePriority:
      incident.priorityOverride ?? calculation.recommendedPriority,
    priorityOverride: incident.priorityOverride,
    overrideReason: incident.priorityOverrideReason,
    factors: calculation.factors,
    unavailableInputs: Array.isArray(input.unavailableInputs)
      ? input.unavailableInputs
      : [],
  });
}

export async function getCurrentSla(
  database: PrismaClient,
  incidentId: string,
  referenceAt = new Date(),
) {
  const { input } = await loadIncidentContext(database, incidentId);
  const { targetMilliseconds, remainingMilliseconds, ...sla } = calculateSla(
    input,
    referenceAt,
  );
  void targetMilliseconds;
  void remainingMilliseconds;
  return IncidentSlaResponseSchema.parse(sla);
}

export async function getCurrentBreachRisk(
  database: PrismaClient,
  incidentId: string,
  referenceAt = new Date(),
) {
  const { input } = await loadIncidentContext(database, incidentId);
  const { response, sla } = calculatePriority(input, referenceAt);
  const { targetMilliseconds, remainingMilliseconds, ...publicSla } = sla;
  void targetMilliseconds;
  void remainingMilliseconds;
  return estimateBreachRisk(incidentId, response, publicSla);
}

export async function generateAndAuditResponsePlan(
  database: PrismaClient,
  incidentId: string,
  actorId: string,
  generatedAt = new Date(),
) {
  const { input, relationships } = await loadIncidentContext(
    database,
    incidentId,
  );
  const plan = IncidentResponsePlanSchema.parse(
    createResponsePlan(
      incidentId,
      input.severity,
      input.alerts,
      relationships,
      generatedAt,
    ),
  );
  await database.$transaction(async (transaction) => {
    for (const step of plan.steps) {
      await writeAuditEvent(transaction, {
        eventType: 'incident.response_step.suggested',
        targetType: 'Incident',
        targetId: incidentId,
        actorId,
        metadata: {
          action: step.action,
          approvalStatus: step.approvalStatus,
          evidenceReferences: step.evidence
            .map(({ kind, id }) => `${kind}:${id}`)
            .join(','),
          performed: step.performed,
          planVersion: 'response-plan-v1',
          rationale: step.rationale,
          stepOrder: step.order,
          status: step.status,
        },
      });
    }
  });
  return plan;
}

export async function overrideIncidentPriority(
  database: PrismaClient,
  incidentId: string,
  actorId: string,
  priority: string,
  reason: string,
  changedAt = new Date(),
): Promise<IncidentPriorityOverrideResponse> {
  const parsedPriority = IncidentPriorityOverrideSchema.parse(priority);
  const normalizedReason = z.string().trim().min(10).max(1000).parse(reason);
  return database.$transaction(async (transaction) => {
    const current = await transaction.incident.findUnique({
      where: { id: incidentId },
      include: {
        priorityCalculations: {
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { recommendedPriority: true },
        },
      },
    });
    if (!current) throw new PriorityIncidentNotFoundError();
    if (current.priorityOverride === parsedPriority) {
      throw new PriorityOverrideConflictError();
    }
    const updatedCount = await transaction.incident.updateMany({
      where: { id: incidentId, updatedAt: current.updatedAt },
      data: {
        priorityOverride: parsedPriority,
        priorityOverrideReason: normalizedReason,
        priorityOverrideActorId: actorId,
        priorityOverrideAt: changedAt,
      },
    });
    if (updatedCount.count !== 1) throw new PriorityOverrideConflictError();
    const fromPriority =
      current.priorityOverride ??
      current.priorityCalculations[0]?.recommendedPriority ??
      'unclassified';
    await writeAuditEvent(transaction, {
      eventType: 'incident.priority.overridden',
      targetType: 'Incident',
      targetId: incidentId,
      actorId,
      metadata: {
        fromPriority,
        toPriority: parsedPriority,
        reason: normalizedReason,
        policyVersion: PRIORITY_POLICY_VERSION,
      },
    });
    return IncidentPriorityOverrideResponseSchema.parse({
      incidentId,
      previousOverride: current.priorityOverride,
      priorityOverride: parsedPriority,
      effectivePriority: parsedPriority,
      reason: normalizedReason,
      actorId,
      changedAt: changedAt.toISOString(),
    });
  });
}
