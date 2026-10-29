import type { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

const writerToken = 'phase-nine-incident-writer-token-32-chars';
const readerToken = 'phase-nine-incident-reader-token-32-chars';

describe('incident and correlation API access controls', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({
      database: {} as PrismaClient,
      credentials: [
        { token: writerToken, subject: 'phase9:writer', scopes: ['api:write'] },
        { token: readerToken, subject: 'phase9:reader', scopes: ['api:read'] },
      ],
      correlationService: {
        correlate: async () => {
          throw new Error('should not be reached');
        },
      },
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('requires write scope for correlation and incident status changes', async () => {
    const missing = await fetch(`${baseUrl}/correlation/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        alertIds: ['6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0'],
      }),
    });
    expect(missing.status).toBe(401);

    const reader = await fetch(`${baseUrl}/correlation/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${readerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        alertIds: ['6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0'],
      }),
    });
    expect(reader.status).toBe(403);

    const invalidRequest = await fetch(`${baseUrl}/correlation/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ alertIds: [] }),
    });
    expect(invalidRequest.status).toBe(400);

    const statusWithoutWrite = await fetch(
      `${baseUrl}/incidents/6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0/status`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${readerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'triaged' }),
      },
    );
    expect(statusWithoutWrite.status).toBe(403);
  });

  it('requires read scope for incident list and details', async () => {
    const missing = await fetch(`${baseUrl}/incidents`);
    expect(missing.status).toBe(401);
    const missingDetail = await fetch(
      `${baseUrl}/incidents/6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0`,
      {
        headers: { authorization: `Bearer ${writerToken}` },
      },
    );
    expect(missingDetail.status).toBe(403);
  });
});

describe('incident list contract isolation', () => {
  it('lists linked incidents and excludes concurrent empty-incident fixtures', async () => {
    const alertId = '2df675d7-43eb-4fce-9ea0-75eadc8bf7c1';
    const incidentId = '61cc7407-bc01-44a9-b657-4d85330f00d0';
    const createdAt = new Date('2026-10-29T10:00:00.000Z');
    const incident = {
      id: incidentId,
      title: 'Synthetic linked incident',
      description: null,
      status: 'new',
      severity: 'high',
      needsHumanReview: null,
      createdAt,
      updatedAt: createdAt,
      alertLinks: [{ alertId }],
    };
    const findMany = vi.fn().mockResolvedValue([incident]);
    const count = vi.fn().mockResolvedValue(1);
    const database = {
      incident: { findMany, count },
    } as unknown as PrismaClient;
    const token = 'incident-list-contract-test-token-32-characters';
    const app = createApp({
      database,
      credentials: [
        { token, subject: 'incident-list-test', scopes: ['api:read'] },
      ],
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/incidents`,
        { headers: { authorization: `Bearer ${token}` } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        items: [{ id: incidentId, alertIds: [alertId] }],
        totalItems: 1,
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { alertLinks: { some: {} } } }),
      );
      expect(count).toHaveBeenCalledWith({
        where: { alertLinks: { some: {} } },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
