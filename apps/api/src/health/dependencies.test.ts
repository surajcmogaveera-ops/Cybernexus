import type { PrismaClient } from '@prisma/client';
import {
  AIServiceReadinessResponseSchema,
  DependencyHealthResponseSchema,
} from '@cybernexus/shared';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AIServiceNotConfigured,
  type AIServiceReadinessClient,
} from '../analysis/service-client.js';
import { createApp } from '../app.js';

describe('dependency health endpoint', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  });

  it('reports verified database and FastAPI readiness without claiming Gemini connectivity', async () => {
    const database = {
      $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
    } as unknown as PrismaClient;
    const readiness = AIServiceReadinessResponseSchema.parse({
      status: 'ok',
      service: 'cybernexus-ai',
      analysisMode: 'deterministic',
      geminiConfiguration: 'disabled',
      geminiConnectivity: 'disabled',
    });
    const aiService: AIServiceReadinessClient = {
      check: vi.fn().mockResolvedValue(readiness),
    };
    server = createApp({ database, aiServiceReadiness: aiService }).listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');

    const response = await fetch(
      `http://127.0.0.1:${address.port}/health/dependencies`,
    );
    const body = DependencyHealthResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      api: { status: 'healthy', verified: true },
      database: { status: 'healthy', verified: true },
      aiService: { status: 'healthy', verified: true },
      aiProvider: {
        analysisMode: 'deterministic',
        geminiConfiguration: 'disabled',
        geminiConnectivity: 'disabled',
        verified: false,
      },
    });
    expect(body.checkedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(JSON.stringify(body)).not.toContain('api-key');
  });

  it('reports independent dependency failures with safe statuses', async () => {
    const database = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('sensitive db detail')),
    } as unknown as PrismaClient;
    const aiService: AIServiceReadinessClient = {
      check: vi.fn().mockRejectedValue(new AIServiceNotConfigured()),
    };
    server = createApp({ database, aiServiceReadiness: aiService }).listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');

    const response = await fetch(
      `http://127.0.0.1:${address.port}/health/dependencies`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"status":"unavailable"');
    expect(body).toContain('"status":"not_configured"');
    expect(body).toContain('"analysisMode":"unknown"');
    expect(body).toContain('"geminiConnectivity":"unverified"');
    expect(body).not.toContain('sensitive db detail');
  });
});
