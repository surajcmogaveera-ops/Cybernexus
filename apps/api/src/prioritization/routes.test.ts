import type { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const writerToken = 'phase14-priority-writer-token-32-characters';
const readerToken = 'phase14-priority-reader-token-32-characters';
const auditorToken = 'phase14-priority-auditor-token-32-characters';
const incidentId = '9a005f9a-1253-4ed7-8ae7-2d04da15e688';

describe('prioritization API validation and authorization', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({
      database: {} as PrismaClient,
      credentials: [
        {
          token: writerToken,
          subject: 'phase14-writer',
          scopes: ['api:write'],
        },
        { token: readerToken, subject: 'phase14-reader', scopes: ['api:read'] },
        {
          token: auditorToken,
          subject: 'phase14-auditor',
          scopes: ['audit:read'],
        },
      ],
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an HTTP server address.');
    }
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/incidents/${incidentId}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('enforces write scope before priority calculation can access persistence', async () => {
    const response = await fetch(`${baseUrl}/priority/recalculate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejects unsupported override and response-plan request fields', async () => {
    const override = await fetch(`${baseUrl}/priority/override`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        priority: 'urgent',
        reason: 'Synthetic invalid priority request',
        execute: true,
      }),
    });
    expect(override.status).toBe(400);
    expect(await override.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const responsePlan = await fetch(`${baseUrl}/response-plan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ execute: true }),
    });
    expect(responsePlan.status).toBe(400);
    expect(await responsePlan.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('rejects malformed audit pagination and invalid incident identifiers safely', async () => {
    const invalidPage = await fetch(`${baseUrl}/audit?pageSize=1000`, {
      headers: { authorization: `Bearer ${auditorToken}` },
    });
    expect(invalidPage.status).toBe(400);
    expect(await invalidPage.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const invalidId = await fetch(
      `${baseUrl.replace(incidentId, 'not-a-uuid')}/sla`,
      { headers: { authorization: `Bearer ${readerToken}` } },
    );
    expect(invalidId.status).toBe(404);
    expect(await invalidId.json()).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });

  it('maps malformed JSON to a safe validation error without echoing credentials', async () => {
    const response = await fetch(`${baseUrl}/priority/recalculate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: '{',
    });
    const text = await response.text();
    expect(response.status).toBe(400);
    expect(text).toContain('MALFORMED_JSON');
    expect(text).not.toContain(writerToken);
    expect(text).not.toContain('SyntaxError');
  });
});
