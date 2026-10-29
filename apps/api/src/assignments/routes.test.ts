import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

const token = 'a'.repeat(48);
const incidentId = '10000000-0000-4000-8000-000000000001';
const analystId = '20000000-0000-4000-8000-000000000001';

async function withServer<T>(
  app: ReturnType<typeof createApp>,
  run: (url: string) => Promise<T>,
) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP server address.');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function databaseMock() {
  const incidents = [
    {
      id: incidentId,
      severity: 'high',
      status: 'triaged',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      assignmentRequirementsKnown: true,
      requiredSkills: [{ skill: 'identity' }],
      assignments: [],
      priorityCalculations: [
        {
          recommendedPriority: 'high',
          deadlineAt: new Date('2026-10-01T04:00:00Z'),
        },
      ],
    },
  ];
  const analysts = [
    {
      id: analystId,
      availability: 'available',
      maxConcurrentAssignments: 2,
      skills: [{ skill: 'identity' }],
      assignments: [],
    },
  ];
  return {
    incident: { findMany: vi.fn().mockResolvedValue(incidents) },
    analyst: { findMany: vi.fn().mockResolvedValue(analysts) },
    assignment: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    assignmentOptimizationRun: {
      create: vi.fn().mockResolvedValue({ id: 'run' }),
      findUnique: vi.fn(),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        assignmentOptimizationRun: {
          create: vi.fn().mockResolvedValue({ id: 'run' }),
        },
        auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
      }),
    ),
  };
}

describe('assignment API', () => {
  it('requires api:write for recommendation generation', async () => {
    const db = databaseMock();
    const app = createApp({
      database: db as unknown as PrismaClient,
      credentials: [{ token, subject: 'reviewer', scopes: ['api:read'] }],
    });
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/v1/assignments/recommend`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(response.status).toBe(403);
      expect(db.incident.findMany).not.toHaveBeenCalled();
    });
  });

  it('rejects duplicate scenario identifiers before reading data', async () => {
    const db = databaseMock();
    const app = createApp({
      database: db as unknown as PrismaClient,
      credentials: [{ token, subject: 'reviewer', scopes: ['api:write'] }],
    });
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/v1/assignments/simulate`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          analystChanges: [{ analystId }, { analystId }],
        }),
      });
      expect(response.status).toBe(400);
      expect(db.incident.findMany).not.toHaveBeenCalled();
      expect(db.assignment.create).not.toHaveBeenCalled();
    });
  });

  it('returns a hypothetical proposal without writing assignment records', async () => {
    const db = databaseMock();
    const app = createApp({
      database: db as unknown as PrismaClient,
      credentials: [{ token, subject: 'reviewer', scopes: ['api:write'] }],
    });
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/v1/assignments/simulate`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          analystChanges: [{ analystId, availability: 'unavailable' }],
        }),
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        assignmentsPersisted: boolean;
        runPersisted: boolean;
        proposed: { analystId: string | null }[];
      };
      expect(result.assignmentsPersisted).toBe(false);
      expect(result.runPersisted).toBe(true);
      expect(result.proposed[0]?.analystId).toBeNull();
      expect(db.assignment.create).not.toHaveBeenCalled();
      expect(db.assignment.updateMany).not.toHaveBeenCalled();
    });
  });

  it('persists a recommendation snapshot and transactional audit entry', async () => {
    const db = databaseMock();
    const app = createApp({
      database: db as unknown as PrismaClient,
      credentials: [{ token, subject: 'reviewer', scopes: ['api:write'] }],
    });
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/v1/assignments/recommend`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        provider: 'baseline',
        assignments: [{ incidentId, analystId, status: 'assigned' }],
      });
      expect(db.$transaction).toHaveBeenCalledOnce();
      expect(db.incident.findMany).toHaveBeenCalledOnce();
    });
  });
});
