import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { PrismaClient } from '@prisma/client';

const testDatabaseUrl = process.env.CYBERNEXUS_TEST_DATABASE_URL;
if (testDatabaseUrl) {
  const url = new URL(testDatabaseUrl);
  if (
    !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) ||
    url.pathname !== '/cybernexus_test'
  ) {
    throw new Error(
      'CYBERNEXUS_TEST_DATABASE_URL must point to a local cybernexus_test database.',
    );
  }
}

const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const apiToken = 'phase-12-assignment-integration-token-only';

databaseDescribe('assignment persistence integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const { PrismaClient: Client } = await import('@prisma/client');
    prisma = new Client();
    await prisma.$connect();
    const identity = await prisma.$queryRaw<
      Array<{ database: string; server: string | null }>
    >`
      SELECT current_database() AS database, inet_server_addr()::text AS server
    `;
    if (
      identity[0]?.database !== 'cybernexus_test' ||
      !['127.0.0.1/32', '::1/128'].includes(identity[0]?.server ?? '')
    ) {
      await prisma.$disconnect();
      throw new Error(
        'Assignment integration tests require local cybernexus_test.',
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('persists a reproducible run, applies it with audit, and rejects stale apply without changing assignment state', async () => {
    const ids = {
      incident: randomUUID(),
      analystOne: randomUUID(),
      analystTwo: randomUUID(),
    };
    const app = createApp({
      database: prisma,
      credentials: [
        {
          token: apiToken,
          subject: 'phase12-integration-analyst',
          scopes: ['api:read', 'api:write'],
        },
        {
          token: 'read-only-token-for-phase12-integration-test',
          subject: 'phase12-reader',
          scopes: ['api:read'],
        },
      ],
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address.');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      await prisma.incident.create({
        data: {
          id: ids.incident,
          title: 'Phase 12 synthetic assignment integration',
          severity: 'high',
          status: 'triaged',
          assignmentRequirementsKnown: true,
          requiredSkills: { create: [{ skill: 'integration-identity' }] },
        },
      });
      await prisma.analyst.createMany({
        data: [
          {
            id: ids.analystOne,
            displayName: 'Phase 12 integration analyst one',
            availability: 'available',
            maxConcurrentAssignments: 2,
          },
          {
            id: ids.analystTwo,
            displayName: 'Phase 12 integration analyst two',
            availability: 'available',
            maxConcurrentAssignments: 2,
          },
        ],
      });
      await prisma.analystSkill.createMany({
        data: [ids.analystOne, ids.analystTwo].map((analystId) => ({
          analystId,
          skill: 'integration-identity',
        })),
      });

      const denied = await fetch(`${baseUrl}/api/v1/assignments/recommend`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer read-only-token-for-phase12-integration-test',
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(denied.status).toBe(403);

      const recommendation = await fetch(
        `${baseUrl}/api/v1/assignments/recommend`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ incidentIds: [ids.incident] }),
        },
      );
      expect(recommendation.status).toBe(201);
      const proposed = (await recommendation.json()) as {
        runId: string;
        assignments: { incidentId: string; status: string }[];
      };
      expect(proposed.assignments).toHaveLength(1);
      expect(proposed.assignments[0]).toMatchObject({
        incidentId: ids.incident,
        status: 'assigned',
      });

      const run = await prisma.assignmentOptimizationRun.findUniqueOrThrow({
        where: { id: proposed.runId },
      });
      expect(run.provider).toBe('baseline');
      const proposalAudit = await prisma.auditEvent.findFirst({
        where: {
          targetType: 'AssignmentOptimizationRun',
          targetId: proposed.runId,
          eventType: 'assignment.plan.generated',
        },
      });
      expect(proposalAudit).not.toBeNull();

      const applied = await fetch(
        `${baseUrl}/api/v1/assignments/runs/${proposed.runId}/apply`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(applied.status).toBe(200);
      const activeBefore = await prisma.assignment.findMany({
        where: { incidentId: ids.incident, status: 'active' },
      });
      expect(activeBefore).toHaveLength(1);
      expect(
        await prisma.auditEvent.count({
          where: {
            targetType: 'AssignmentOptimizationRun',
            targetId: proposed.runId,
            eventType: 'assignment.plan.applied',
          },
        }),
      ).toBe(1);

      const unavailable = await prisma.analyst.update({
        where: { id: activeBefore[0]!.analystId },
        data: { availability: 'unavailable' },
      });
      expect(unavailable.availability).toBe('unavailable');
      const staleApply = await fetch(
        `${baseUrl}/api/v1/assignments/runs/${proposed.runId}/apply`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(staleApply.status).toBe(409);
      const activeAfter = await prisma.assignment.findMany({
        where: { incidentId: ids.incident, status: 'active' },
      });
      expect(
        activeAfter.map(({ id, analystId }) => ({ id, analystId })),
      ).toEqual(activeBefore.map(({ id, analystId }) => ({ id, analystId })));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await prisma.auditEvent.deleteMany({
        where: {
          actorId: { in: ['phase12-integration-analyst', 'phase12-reader'] },
        },
      });
      await prisma.assignmentOptimizationRun.deleteMany({
        where: {
          actorId: { in: ['phase12-integration-analyst', 'phase12-reader'] },
        },
      });
      await prisma.assignment.deleteMany({
        where: { incidentId: ids.incident },
      });
      await prisma.incidentRequiredSkill.deleteMany({
        where: { incidentId: ids.incident },
      });
      await prisma.analystSkill.deleteMany({
        where: { analystId: { in: [ids.analystOne, ids.analystTwo] } },
      });
      await prisma.incident.deleteMany({ where: { id: ids.incident } });
      await prisma.analyst.deleteMany({
        where: { id: { in: [ids.analystOne, ids.analystTwo] } },
      });
    }
  }, 30_000);

  it('runs concurrent apply attempts without creating duplicate active assignments', async () => {
    const incidentId = randomUUID();
    const analystId = randomUUID();
    const actorId = `phase12-race-${randomUUID()}`;
    const app = createApp({
      database: prisma,
      credentials: [
        {
          token: apiToken,
          subject: actorId,
          scopes: ['api:read', 'api:write'],
        },
      ],
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address.');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      await prisma.incident.create({
        data: {
          id: incidentId,
          title: 'Phase 12 concurrent apply fixture',
          severity: 'medium',
          status: 'new',
          assignmentRequirementsKnown: true,
          requiredSkills: { create: [{ skill: 'integration-race' }] },
        },
      });
      await prisma.analyst.create({
        data: {
          id: analystId,
          displayName: 'Phase 12 concurrent analyst',
          availability: 'available',
          maxConcurrentAssignments: 1,
          skills: { create: [{ skill: 'integration-race' }] },
        },
      });
      const recommendation = await fetch(
        `${baseUrl}/api/v1/assignments/recommend`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ incidentIds: [incidentId] }),
        },
      );
      const { runId } = (await recommendation.json()) as { runId: string };
      const apply = () =>
        fetch(`${baseUrl}/api/v1/assignments/runs/${runId}/apply`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: '{}',
        });
      const responses = await Promise.all([apply(), apply()]);
      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(
        await prisma.assignment.count({
          where: { incidentId, status: 'active' },
        }),
      ).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      const runs = await prisma.assignmentOptimizationRun.findMany({
        where: { actorId },
        select: { id: true },
      });
      await prisma.auditEvent.deleteMany({
        where: {
          targetType: 'AssignmentOptimizationRun',
          targetId: { in: runs.map(({ id }) => id) },
        },
      });
      await prisma.assignmentOptimizationRun.deleteMany({ where: { actorId } });
      await prisma.assignment.deleteMany({ where: { incidentId } });
      await prisma.incidentRequiredSkill.deleteMany({ where: { incidentId } });
      await prisma.analystSkill.deleteMany({ where: { analystId } });
      await prisma.incident.deleteMany({ where: { id: incidentId } });
      await prisma.analyst.deleteMany({ where: { id: analystId } });
    }
  }, 30_000);
});
