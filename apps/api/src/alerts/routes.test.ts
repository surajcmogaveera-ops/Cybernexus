import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { AlertRecord } from './contracts.js';
import type { AlertRepository } from './repository.js';

const writerToken = 'phase-eight-writer-token-with-32-chars';
const readerToken = 'phase-eight-reader-token-with-32-chars';
const alertId = '6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0';
const sampleRecord = {
  source: 'DEMO-IDP',
  externalId: 'event-001',
  observedAt: '2026-10-29T13:45:00+05:30',
  title: 'Synthetic login event',
  severity: 'warning',
  payload: { userId: 'demo-user-01', synthetic: true },
};

const storedAlert: AlertRecord = {
  id: alertId,
  source: 'demo-idp',
  externalId: 'event-001',
  title: 'Synthetic login event',
  severity: 'medium',
  observedAt: '2026-10-29T08:15:00.000Z',
  ingestedAt: '2026-10-29T08:16:00.000Z',
  payload: { userId: 'demo-user-01', synthetic: true },
  normalizedAttributes: { userId: 'demo-user-01' },
};

describe('versioned alert API', () => {
  let server: Server;
  let baseUrl: string;
  const ingest = vi.fn<AlertRepository['ingest']>();
  const list = vi.fn<AlertRepository['list']>();

  beforeAll(async () => {
    const repository: AlertRepository = { ingest, list };
    const app = createApp({
      credentials: [
        {
          token: writerToken,
          subject: 'analyst:writer',
          scopes: ['api:read', 'api:write', 'audit:write'],
        },
        {
          token: readerToken,
          subject: 'analyst:reader',
          scopes: ['api:read'],
        },
      ],
      alertRepository: repository,
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/alerts`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('requires write scope for ingestion and returns a validated accepted record', async () => {
    const unauthenticated = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleRecord),
    });
    expect(unauthenticated.status).toBe(401);

    const reader = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${readerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(sampleRecord),
    });
    expect(reader.status).toBe(403);

    ingest.mockResolvedValueOnce({ kind: 'accepted', alert: storedAlert });
    const response = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(sampleRecord),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      status: 'accepted',
      alert: storedAlert,
    });
    expect(ingest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'demo-idp',
        severity: 'medium',
        observedAt: new Date('2026-10-29T08:15:00Z'),
      }),
      'analyst:writer',
    );
  });

  it('distinguishes exact duplicates from changed content for a source event ID', async () => {
    ingest
      .mockResolvedValueOnce({ kind: 'duplicate', alertId })
      .mockResolvedValueOnce({ kind: 'conflict', alertId });
    const headers = {
      authorization: `Bearer ${writerToken}`,
      'content-type': 'application/json',
    };
    const duplicate = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sampleRecord),
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ status: 'duplicate', alertId });

    const conflict = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...sampleRecord, title: 'Changed event' }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Source event identifier conflicts with stored content.',
      },
    });
  });

  it('uses a bounded Idempotency-Key for alerts without a source event ID', async () => {
    ingest.mockResolvedValueOnce({ kind: 'accepted', alert: storedAlert });
    const { externalId: _externalId, ...idlessRecord } = sampleRecord;
    const response = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
        'Idempotency-Key': 'retry-key-001',
      },
      body: JSON.stringify(idlessRecord),
    });
    expect(response.status).toBe(201);
    expect(ingest).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ externalId: expect.anything() }),
      'analyst:writer',
    );
    expect(ingest).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: 'retry-key-001' }),
      'analyst:writer',
    );

    const invalidKey = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
        'Idempotency-Key': 'contains a space',
      },
      body: JSON.stringify(idlessRecord),
    });
    expect(invalidKey.status).toBe(400);
  });

  it('reports accepted, rejected, duplicate, and failed records for a mixed batch', async () => {
    ingest
      .mockResolvedValueOnce({ kind: 'accepted', alert: storedAlert })
      .mockResolvedValueOnce({ kind: 'duplicate', alertId })
      .mockResolvedValueOnce({ kind: 'conflict', alertId })
      .mockRejectedValueOnce(new Error('database password must not escape'));
    const batch = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
        'Idempotency-Key': 'batch-retry-key-001',
      },
      body: JSON.stringify({
        records: [
          sampleRecord,
          sampleRecord,
          { ...sampleRecord, externalId: 'conflicting-event' },
          { source: 'demo-idp', title: 'Missing required fields' },
          { ...sampleRecord, externalId: 'database-failure' },
        ],
      }),
    });
    expect(batch.status).toBe(200);
    const body = (await batch.json()) as {
      accepted: number;
      rejected: number;
      duplicate: number;
      failed: number;
      records: { status: string; error?: { message: string } }[];
    };
    expect(body).toMatchObject({
      accepted: 1,
      rejected: 2,
      duplicate: 1,
      failed: 1,
    });
    expect(body.records.map(({ status }) => status)).toEqual([
      'accepted',
      'duplicate',
      'rejected',
      'rejected',
      'failed',
    ]);
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'batch-retry-key-001:0' }),
      'analyst:writer',
      0,
    );
    expect(JSON.stringify(body)).not.toContain('database password');
  });

  it('validates list filters, pagination, and read scope', async () => {
    list.mockResolvedValueOnce({
      items: [storedAlert],
      page: 2,
      pageSize: 1,
      hasNext: true,
      totalItems: 3,
    });
    const response = await fetch(
      `${baseUrl}?page=2&pageSize=1&source=DEMO-IDP&severity=warning&from=2026-10-29T08%3A00%3A00Z&q=login`,
      { headers: { authorization: `Bearer ${readerToken}` } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      page: 2,
      pageSize: 1,
      hasNext: true,
      totalItems: 3,
    });
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 1,
        source: 'demo-idp',
        severity: 'medium',
        q: 'login',
      }),
    );

    const invalid = await fetch(`${baseUrl}?page=0`, {
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(invalid.status).toBe(400);
  });
});
