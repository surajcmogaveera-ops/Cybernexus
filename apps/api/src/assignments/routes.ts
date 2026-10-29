import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiErrorResponseSchema, IdentifierSchema } from '@cybernexus/shared';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { writeAuditEvent } from '../audit/write-audit-event.js';
import { requireScopes } from '../security/auth.js';
import {
  AssignmentRecommendationRequestSchema,
  AssignmentScenarioSchema,
  ManualAssignmentSchema,
} from './contracts.js';
import {
  ASSIGNMENT_POLICY_VERSION,
  createBaselineAssignmentPlan,
  validateAssignmentPlan,
} from './baseline.js';

type Principal = { subject: string };
type IncidentRow = {
  id: string;
  severity: string;
  createdAt: Date;
  status: string;
  assignmentRequirementsKnown: boolean;
  requiredSkills: { skill: string }[];
  priorityOverride: string | null;
  priorityCalculations: {
    recommendedPriority: string;
    deadlineAt: Date | null;
  }[];
  assignments: { analystId: string; status: string }[];
};
type AnalystRow = {
  id: string;
  availability: 'available' | 'unavailable';
  maxConcurrentAssignments: number | null;
  skills: { skill: string }[];
  assignments: { status: string }[];
};

export function createAssignmentRouter(database: PrismaClient): Router {
  const router = Router();
  router.get('/current', requireScopes('api:read'), (_req, res, next) =>
    currentAssignments(database, res, next),
  );
  router.get(
    '/incidents/:incidentId/history',
    requireScopes('api:read'),
    (req, res, next) => assignmentHistory(database, req, res, next),
  );
  router.post('/recommend', requireScopes('api:write'), (req, res, next) =>
    recommend(database, req, res, next),
  );
  router.post('/simulate', requireScopes('api:write'), (req, res, next) =>
    simulate(database, req, res, next),
  );
  router.get('/runs/:runId', requireScopes('api:read'), (req, res, next) =>
    getRun(database, req, res, next),
  );
  router.post(
    '/runs/:runId/apply',
    requireScopes('api:write'),
    (req, res, next) => applyRun(database, req, res, next),
  );
  router.post(
    '/incidents/:incidentId/reassign',
    requireScopes('api:write'),
    (req, res, next) => reassign(database, req, res, next),
  );
  return router;
}

async function loadSnapshot(database: PrismaClient, incidentIds?: string[]) {
  const incidentRows = await database.incident.findMany({
    where: {
      status: { notIn: ['resolved', 'closed'] },
      ...(incidentIds ? { id: { in: incidentIds } } : {}),
    },
    include: {
      requiredSkills: { orderBy: { skill: 'asc' }, select: { skill: true } },
      assignments: {
        where: { status: 'active' },
        select: { analystId: true, status: true },
      },
      priorityCalculations: {
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { recommendedPriority: true, deadlineAt: true },
      },
    },
    orderBy: { id: 'asc' },
    take: 500,
  });
  const incidentContext = incidentRows as IncidentRow[];
  const requiredSkills = [
    ...new Set(
      incidentContext.flatMap((item) =>
        item.assignmentRequirementsKnown
          ? item.requiredSkills.map(({ skill }) => skill)
          : [],
      ),
    ),
  ];
  const hasKnownEmptyRequirements = incidentContext.some(
    (item) =>
      item.assignmentRequirementsKnown && item.requiredSkills.length === 0,
  );
  const analystRows = await database.analyst.findMany({
    ...(incidentIds
      ? {
          where: {
            OR: [
              ...(requiredSkills.length
                ? [{ skills: { some: { skill: { in: requiredSkills } } } }]
                : []),
              ...(hasKnownEmptyRequirements
                ? [{ availability: 'available' as const }]
                : []),
              {
                assignments: {
                  some: {
                    incidentId: { in: incidentIds },
                    status: 'active' as const,
                  },
                },
              },
            ],
          },
        }
      : {}),
    include: {
      skills: { orderBy: { skill: 'asc' }, select: { skill: true } },
      assignments: { where: { status: 'active' }, select: { status: true } },
    },
    orderBy: { id: 'asc' },
    take: 500,
  });
  const incidents = incidentContext.map((item) => ({
    id: item.id,
    requiredSkills: item.assignmentRequirementsKnown
      ? item.requiredSkills.map(({ skill }) => skill)
      : null,
    currentAnalystIds: item.assignments
      .map(({ analystId }) => analystId)
      .sort(),
    priority: (item.priorityOverride ??
      item.priorityCalculations[0]?.recommendedPriority ??
      'unclassified') as
      'critical' | 'high' | 'medium' | 'low' | 'unclassified',
    deadlineAt: item.priorityCalculations[0]?.deadlineAt ?? null,
    createdAt: item.createdAt,
  }));
  const analysts = (analystRows as AnalystRow[]).map((item) => ({
    id: item.id,
    skills: item.skills.map(({ skill }) => skill),
    availability: item.availability,
    maxConcurrentAssignments: item.maxConcurrentAssignments,
    activeAssignments: item.assignments.length,
  }));
  return { incidents, analysts };
}

async function currentAssignments(
  database: PrismaClient,
  response: Response,
  next: NextFunction,
) {
  try {
    const assignments = await database.assignment.findMany({
      where: { status: 'active' },
      include: {
        analyst: { select: { id: true, displayName: true } },
        incident: { select: { id: true, title: true, severity: true } },
      },
      orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    response.json({ assignments });
  } catch (error) {
    next(error);
  }
}

async function assignmentHistory(
  database: PrismaClient,
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const incidentId =
    typeof request.params.incidentId === 'string'
      ? request.params.incidentId
      : '';
  if (!IdentifierSchema.safeParse(incidentId).success)
    return sendError(response, 404, 'NOT_FOUND', 'Incident was not found.');
  try {
    const [incident, assignments] = await Promise.all([
      database.incident.findUnique({
        where: { id: incidentId },
        select: { id: true },
      }),
      database.assignment.findMany({
        where: { incidentId },
        include: { analyst: { select: { id: true, displayName: true } } },
        orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
    ]);
    if (!incident)
      return sendError(response, 404, 'NOT_FOUND', 'Incident was not found.');
    response.json({ incidentId, assignments });
  } catch (error) {
    next(error);
  }
}

async function recommend(
  database: PrismaClient,
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const parsed = AssignmentRecommendationRequestSchema.safeParse(
    request.body ?? {},
  );
  if (!parsed.success)
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      'Recommendation request is invalid.',
    );
  try {
    const started = Date.now();
    const inputSnapshot = await loadSnapshot(database, parsed.data.incidentIds);
    const assignments = createBaselineAssignmentPlan(
      inputSnapshot.incidents,
      inputSnapshot.analysts,
    );
    const validationErrors = validateAssignmentPlan(
      inputSnapshot.incidents,
      inputSnapshot.analysts,
      assignments,
    );
    if (validationErrors.length)
      throw new Error(
        'Generated assignment plan failed independent constraint validation.',
      );
    const runtimeMs = Date.now() - started;
    const actorId = (response.locals.principal as Principal).subject;
    const id = randomUUID();
    await database.$transaction(async (tx) => {
      await tx.assignmentOptimizationRun.create({
        data: {
          id,
          algorithmVersion: ASSIGNMENT_POLICY_VERSION,
          provider: 'baseline',
          status: 'completed',
          actorId,
          runtimeMs,
          inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
          result: {
            assignments,
            validation: { valid: true, errors: [] },
            unassignedCount: assignments.filter(
              (item) => item.status === 'unassigned',
            ).length,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAuditEvent(tx, {
        eventType: 'assignment.plan.generated',
        targetType: 'AssignmentOptimizationRun',
        targetId: id,
        actorId,
        metadata: {
          algorithmVersion: ASSIGNMENT_POLICY_VERSION,
          provider: 'baseline',
          incidentCount: assignments.length,
          unassignedCount: assignments.filter(
            (item) => item.status === 'unassigned',
          ).length,
        },
      });
    });
    response.status(201).json({
      runId: id,
      provider: 'baseline',
      algorithmVersion: ASSIGNMENT_POLICY_VERSION,
      runtimeMs,
      assignments,
    });
  } catch (error) {
    next(error);
  }
}

async function simulate(
  database: PrismaClient,
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const parsed = AssignmentScenarioSchema.safeParse(request.body ?? {});
  if (!parsed.success)
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      'Scenario did not match the supported assignment simulation format.',
    );
  try {
    const started = Date.now();
    const snapshot = await loadSnapshot(database);
    const analystChanges = new Map(
      parsed.data.analystChanges.map((change) => [change.analystId, change]),
    );
    const incidentChanges = new Map(
      parsed.data.incidentChanges.map((change) => [change.incidentId, change]),
    );
    if (
      [...analystChanges.keys()].some(
        (id) => !snapshot.analysts.some((item) => item.id === id),
      ) ||
      [...incidentChanges.keys()].some(
        (id) => !snapshot.incidents.some((item) => item.id === id),
      )
    )
      return sendError(
        response,
        404,
        'NOT_FOUND',
        'A scenario referenced an unknown analyst or active incident.',
      );
    const existingIncidentIds = new Set(snapshot.incidents.map(({ id }) => id));
    if (parsed.data.newIncidents.some(({ id }) => existingIncidentIds.has(id)))
      return sendError(
        response,
        400,
        'VALIDATION_ERROR',
        'A hypothetical incident ID must not match a persisted incident.',
      );
    const scenario = {
      analysts: snapshot.analysts.map((item) => ({
        ...item,
        ...analystChanges.get(item.id),
      })),
      incidents: [
        ...snapshot.incidents.map((item) => {
          const change = incidentChanges.get(item.id);
          return change
            ? {
                ...item,
                ...change,
                deadlineAt: change.deadlineAt
                  ? new Date(change.deadlineAt)
                  : item.deadlineAt,
              }
            : item;
        }),
        ...parsed.data.newIncidents.map((item) => ({
          id: item.id,
          requiredSkills: item.requiredSkills,
          priority: item.priority,
          deadlineAt: item.deadlineAt ? new Date(item.deadlineAt) : null,
          createdAt: new Date(item.createdAt),
        })),
      ],
    };
    const current = createBaselineAssignmentPlan(
      snapshot.incidents,
      snapshot.analysts,
    );
    const proposed = createBaselineAssignmentPlan(
      scenario.incidents,
      scenario.analysts,
    );
    const validationErrors = validateAssignmentPlan(
      scenario.incidents,
      scenario.analysts,
      proposed,
    );
    const currentMap = new Map(current.map((item) => [item.incidentId, item]));
    const changes = proposed
      .filter(
        (item) => item.analystId !== currentMap.get(item.incidentId)?.analystId,
      )
      .map((item) => ({
        incidentId: item.incidentId,
        previousAnalystId: currentMap.get(item.incidentId)?.analystId ?? null,
        proposedAnalystId: item.analystId,
        explanation: item.reason,
      }));
    const runtimeMs = Date.now() - started;
    const runId = randomUUID();
    const actorId = (response.locals.principal as Principal).subject;
    const simulationSnapshot = { snapshot, scenario: parsed.data };
    const simulationResult = {
      proposed,
      changes,
      unassignedCount: proposed.filter((item) => item.status === 'unassigned')
        .length,
      validation: {
        valid: validationErrors.length === 0,
        errors: validationErrors,
      },
    };
    await database.$transaction(async (tx) => {
      await tx.assignmentOptimizationRun.create({
        data: {
          id: runId,
          algorithmVersion: ASSIGNMENT_POLICY_VERSION,
          provider: 'baseline',
          status: 'simulated',
          actorId,
          runtimeMs,
          inputSnapshot: simulationSnapshot as unknown as Prisma.InputJsonValue,
          result: simulationResult as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAuditEvent(tx, {
        eventType: 'assignment.what_if.simulated',
        targetType: 'AssignmentOptimizationRun',
        targetId: runId,
        actorId,
        metadata: {
          algorithmVersion: ASSIGNMENT_POLICY_VERSION,
          incidentCount: proposed.length,
          changedCount: changes.length,
        },
      });
    });
    response.json({
      runId,
      provider: 'baseline',
      assignmentsPersisted: false,
      runPersisted: true,
      proposed,
      changes,
      unassignedCount: proposed.filter((item) => item.status === 'unassigned')
        .length,
      validation: {
        valid: validationErrors.length === 0,
        errors: validationErrors,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getRun(
  database: PrismaClient,
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const runId =
    typeof request.params.runId === 'string' ? request.params.runId : '';
  if (!IdentifierSchema.safeParse(runId).success)
    return sendError(
      response,
      404,
      'NOT_FOUND',
      'Assignment run was not found.',
    );
  try {
    const run = await database.assignmentOptimizationRun.findUnique({
      where: { id: runId },
    });
    if (!run)
      return sendError(
        response,
        404,
        'NOT_FOUND',
        'Assignment run was not found.',
      );
    response.json({ run });
  } catch (error) {
    next(error);
  }
}

async function applyRun(
  database: PrismaClient,
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const runId =
    typeof request.params.runId === 'string' ? request.params.runId : '';
  if (
    !IdentifierSchema.safeParse(runId).success ||
    (request.body && Object.keys(request.body).length)
  )
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      'Run ID or request body is invalid.',
    );
  const actorId = (response.locals.principal as Principal).subject;
  try {
    const result = await database.$transaction(
      async (tx) => {
        const run = await tx.assignmentOptimizationRun.findUnique({
          where: { id: runId },
        });
        if (!run || run.provider !== 'baseline' || run.status !== 'completed')
          throw new AssignmentRunConflict();
        const snapshotObject = run.inputSnapshot as {
          incidents?: { id?: unknown }[];
        };
        const runIncidentIds = snapshotObject.incidents?.map(({ id }) => id);
        if (
          !Array.isArray(runIncidentIds) ||
          runIncidentIds.some((id) => typeof id !== 'string')
        )
          throw new AssignmentRunConflict();
        const snapshot = await loadSnapshot(
          tx as unknown as PrismaClient,
          runIncidentIds as string[],
        );
        if (stableJson(snapshot) !== stableJson(run.inputSnapshot))
          throw new AssignmentRunConflict();
        const plan = createBaselineAssignmentPlan(
          snapshot.incidents,
          snapshot.analysts,
        );
        if (
          validateAssignmentPlan(snapshot.incidents, snapshot.analysts, plan)
            .length
        )
          throw new AssignmentRunConflict();
        const assignments = [];
        for (const item of plan) {
          if (item.status !== 'assigned' || !item.analystId) continue;
          const old = await tx.assignment.findMany({
            where: { incidentId: item.incidentId, status: 'active' },
          });
          const existing = old.find((row) => row.analystId === item.analystId);
          if (existing) {
            assignments.push(existing);
            continue;
          }
          await tx.assignment.updateMany({
            where: { incidentId: item.incidentId, status: 'active' },
            data: { status: 'reassigned' },
          });
          assignments.push(
            await tx.assignment.create({
              data: {
                id: randomUUID(),
                incidentId: item.incidentId,
                analystId: item.analystId!,
                status: 'active',
                explanation: item.reason,
              },
            }),
          );
        }
        await writeAuditEvent(tx, {
          eventType: 'assignment.plan.applied',
          targetType: 'AssignmentOptimizationRun',
          targetId: run.id,
          actorId,
          metadata: { assignmentCount: assignments.length },
        });
        return assignments;
      },
      { isolationLevel: 'Serializable' },
    );
    response.json({ assignments: result });
  } catch (error) {
    if (
      error instanceof AssignmentRunConflict ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2034')
    )
      return sendError(
        response,
        409,
        'CONFLICT',
        'Assignment state changed or the run is infeasible; generate a new plan.',
      );
    next(error);
  }
}

class AssignmentRunConflict extends Error {}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function reassign(
  database: PrismaClient,
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const incidentId =
    typeof request.params.incidentId === 'string'
      ? request.params.incidentId
      : '';
  if (!IdentifierSchema.safeParse(incidentId).success)
    return sendError(response, 404, 'NOT_FOUND', 'Incident was not found.');
  const parsed = ManualAssignmentSchema.safeParse(request.body);
  if (!parsed.success)
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      'Manual assignment request is invalid.',
    );
  const actorId = (response.locals.principal as Principal).subject;
  try {
    const created = await database.$transaction(
      async (tx) => {
        const incident = (await tx.incident.findUnique({
          where: { id: incidentId },
          include: { requiredSkills: true },
        })) as unknown as {
          id: string;
          assignmentRequirementsKnown: boolean;
          requiredSkills: { skill: string }[];
        } | null;
        const analyst = await tx.analyst.findUnique({
          where: { id: parsed.data.analystId },
          include: {
            skills: true,
            assignments: { where: { status: 'active' } },
          },
        });
        if (!incident || !analyst) throw new AssignmentRunConflict();
        if (
          !incident.assignmentRequirementsKnown ||
          analyst.availability !== 'available' ||
          analyst.maxConcurrentAssignments === null ||
          !incident.requiredSkills.every((skill) =>
            analyst.skills.some((item) => item.skill === skill.skill),
          ) ||
          analyst.assignments.filter((item) => item.incidentId !== incident.id)
            .length >= analyst.maxConcurrentAssignments
        )
          throw new AssignmentRunConflict();
        const previousAssignments = await tx.assignment.findMany({
          where: { incidentId: incident.id, status: 'active' },
          select: { analystId: true },
        });
        await tx.assignment.updateMany({
          where: { incidentId: incident.id, status: 'active' },
          data: { status: 'reassigned' },
        });
        const assignment = await tx.assignment.create({
          data: {
            id: randomUUID(),
            incidentId: incident.id,
            analystId: analyst.id,
            status: 'active',
            explanation: parsed.data.reason,
          },
        });
        await writeAuditEvent(tx, {
          eventType: 'assignment.manually_reassigned',
          targetType: 'Incident',
          targetId: incident.id,
          actorId,
          metadata: {
            previousAnalystIds: previousAssignments.map(
              ({ analystId }) => analystId,
            ),
            newAnalystId: analyst.id,
            reason: parsed.data.reason,
          },
        });
        return assignment;
      },
      { isolationLevel: 'Serializable' },
    );
    response.status(201).json({ assignment: created });
  } catch (error) {
    if (error instanceof AssignmentRunConflict)
      return sendError(
        response,
        409,
        'CONFLICT',
        'The analyst is not eligible or assignment state changed.',
      );
    next(error);
  }
}

function sendError(
  response: Response,
  status: number,
  code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT',
  message: string,
): void {
  response
    .status(status)
    .json(ApiErrorResponseSchema.parse({ error: { code, message } }));
}
