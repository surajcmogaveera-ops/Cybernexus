import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IncidentAnalysisResult } from '@cybernexus/shared';
import { createApp } from '../app.js';
import { AnalysisServiceUnavailable } from './service-client.js';

const writerToken = 'phase-ten-analysis-writer-token-32-characters';
const readerToken = 'phase-ten-analysis-reader-token-32-characters';
const incidentId = '9a005f9a-1253-4ed7-8ae7-2d04da15e688';
const alertId = '15a3a4d2-59ba-4170-a25b-5b7ef3f71cb6';
const foreignAlertId = '10000000-0000-4000-8000-000000000001';
const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/shared/fixtures/incident-analysis-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { result: Record<string, unknown> };

function databaseStub(incident: unknown) {
  const auditCreate = vi.fn(async ({ data }: { data: unknown }) => ({
    id: incidentId,
    ...(data as object),
  }));
  const database = {
    incident: { findUnique: vi.fn(async () => incident) },
    alertRelationship: { findMany: vi.fn(async () => []) },
    analysisRun: { create: vi.fn(), findFirst: vi.fn(async () => null) },
    auditEvent: { create: auditCreate },
    $transaction: vi.fn(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ auditEvent: { create: auditCreate } }),
    ),
  } as unknown as PrismaClient;
  return { database, auditCreate };
}

function incidentWithAlert() {
  return {
    id: incidentId,
    severity: 'high',
    status: 'new',
    alertLinks: [
      {
        incidentId,
        alertId,
        alert: {
          id: alertId,
          source: 'synthetic-idp',
          externalId: 'evt-1',
          alertType: 'sign_in_anomaly',
          title: 'Synthetic test alert',
          severity: 'high',
          observedAt: new Date('2026-10-28T08:15:00.000Z'),
        },
      },
    ],
  };
}

describe('incident analysis public API', () => {
  let server: Server;
  let baseUrl: string;
  let database: PrismaClient;
  let auditCreate: ReturnType<typeof vi.fn>;
  let service: { analyze: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    const stub = databaseStub(incidentWithAlert());
    database = stub.database;
    auditCreate = stub.auditCreate;
    service = { analyze: vi.fn() };
    const app = createApp({
      database,
      credentials: [
        {
          token: writerToken,
          subject: 'phase10:writer',
          scopes: ['api:write'],
        },
        { token: readerToken, subject: 'phase10:reader', scopes: ['api:read'] },
      ],
      incidentAnalysisService: service as never,
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/incidents/${incidentId}/analysis`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('enforces read/write scopes and rejects caller-supplied evidence selectors', async () => {
    const unauthorized = await fetch(baseUrl, { method: 'POST' });
    expect(unauthorized.status).toBe(401);
    const readerWrite = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${readerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ alertIds: [alertId] }),
    });
    expect(readerWrite.status).toBe(403);
    const writerRead = await fetch(baseUrl, {
      headers: { authorization: `Bearer ${writerToken}` },
    });
    expect(writerRead.status).toBe(403);
    const extraInput = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ alertIds: [foreignAlertId] }),
    });
    expect(extraInput.status).toBe(400);
    expect(service.analyze).not.toHaveBeenCalled();
  });

  it('returns not found or conflict for nonexistent and empty incidents', async () => {
    const noIncidentStub = databaseStub(null);
    const app = createApp({
      database: noIncidentStub.database,
      credentials: [
        {
          token: writerToken,
          subject: 'phase10:writer',
          scopes: ['api:write'],
        },
      ],
      incidentAnalysisService: { analyze: vi.fn() } as never,
    });
    const temporary = app.listen(0);
    await new Promise<void>((resolve) => temporary.once('listening', resolve));
    const address = temporary.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/incidents/${incidentId}/analysis`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${writerToken}`,
            'content-type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(response.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => temporary.close(() => resolve()));
    }

    const emptyStub = databaseStub({
      id: incidentId,
      severity: 'high',
      status: 'new',
      alertLinks: [],
    });
    const emptyApp = createApp({
      database: emptyStub.database,
      credentials: [
        {
          token: writerToken,
          subject: 'phase10:writer',
          scopes: ['api:write'],
        },
      ],
      incidentAnalysisService: { analyze: vi.fn() } as never,
    });
    const emptyServer = emptyApp.listen(0);
    await new Promise<void>((resolve) =>
      emptyServer.once('listening', resolve),
    );
    const emptyAddress = emptyServer.address();
    if (!emptyAddress || typeof emptyAddress === 'string')
      throw new Error('Expected TCP server address');
    try {
      const response = await fetch(
        `http://127.0.0.1:${emptyAddress.port}/api/v1/incidents/${incidentId}/analysis`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${writerToken}`,
            'content-type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(response.status).toBe(409);
    } finally {
      await new Promise<void>((resolve) => emptyServer.close(() => resolve()));
    }
  });

  it('returns safe service errors and records the failure without persisting analysis', async () => {
    service.analyze.mockRejectedValue(new AnalysisServiceUnavailable());
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    expect(
      database.analysisRun.create as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'incident.analysis.failed',
          metadata: { failureClass: 'service_unavailable' },
        }),
      }),
    );
  });

  it('rejects an out-of-incident evidence reference without persisting a successful run', async () => {
    service.analyze.mockImplementation(
      async (request: { requestId: string }) =>
        ({
          ...(fixture.result as object),
          requestId: request.requestId,
          reportedConflicts: [],
          findings: [
            {
              ...(fixture.result.findings as Record<string, unknown>[])[0]!,
              evidence: [
                { kind: 'alert', id: foreignAlertId, fieldPaths: ['severity'] },
              ],
            },
          ],
        }) as unknown as IncidentAnalysisResult,
    );
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(foreignAlertId);
    expect(
      database.analysisRun.create as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: { failureClass: 'invalid_service_output' },
        }),
      }),
    );
  });
});
