import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  ApiGatewayErrorResponseSchema,
  ApiSessionResponseSchema,
} from '@cybernexus/shared';
import { writeAuditEvent } from './audit/write-audit-event.js';
import { createApp } from './app.js';
import {
  createApiAuthConfiguration,
  loadApiAuthConfiguration,
  type ApiCredential,
} from './security/auth.js';

const token = 'a'.repeat(48);
const readCredential: ApiCredential = {
  token,
  subject: 'analyst-7',
  scopes: ['api:read'],
};

async function withServer<T>(
  app: ReturnType<typeof createApp>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address.');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('Express API access controls', () => {
  it('fails closed when API token configuration is absent or invalid', async () => {
    expect(loadApiAuthConfiguration(undefined)).toEqual({ status: 'missing' });
    expect(loadApiAuthConfiguration('{invalid')).toEqual({ status: 'invalid' });
    expect(
      loadApiAuthConfiguration(JSON.stringify([readCredential])).status,
    ).toBe('ready');
    expect(
      createApiAuthConfiguration([{ ...readCredential, token: 'short' }])
        .status,
    ).toBe('invalid');

    await withServer(createApp({ credentials: [] }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/session`);
      expect(response.status).toBe(503);
      expect(
        ApiGatewayErrorResponseSchema.parse(await response.json()).error.code,
      ).toBe('AUTHENTICATION_UNAVAILABLE');
    });
  });

  it('requires a bearer credential and emits a request ID without echoing secrets', async () => {
    await withServer(
      createApp({ credentials: [readCredential] }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/session`, {
          headers: { 'x-request-id': 'attacker-controlled' },
        });
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer');
        expect(response.headers.get('x-request-id')).toMatch(
          /^[0-9a-f-]{36}$/i,
        );
        expect(response.headers.get('x-request-id')).not.toBe(
          'attacker-controlled',
        );
        expect(
          ApiGatewayErrorResponseSchema.parse(await response.json()).error.code,
        ).toBe('AUTHENTICATION_REQUIRED');

        const rejected = await fetch(`${baseUrl}/api/v1/session`, {
          headers: { authorization: `Bearer ${'b'.repeat(48)}` },
        });
        expect(rejected.status).toBe(401);
        expect(await rejected.text()).not.toContain(token);
      },
    );
  });

  it('applies scope policy and returns only the authenticated principal', async () => {
    await withServer(
      createApp({ credentials: [readCredential] }),
      async (baseUrl) => {
        const authorized = await fetch(`${baseUrl}/api/v1/session`, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(authorized.status).toBe(200);
        expect(ApiSessionResponseSchema.parse(await authorized.json())).toEqual(
          {
            subject: 'analyst-7',
            scopes: ['api:read'],
          },
        );

        const forbidden = await withServer(
          createApp({
            credentials: [{ ...readCredential, scopes: ['api:write'] }],
          }),
          (innerUrl) =>
            fetch(`${innerUrl}/api/v1/session`, {
              headers: { authorization: `Bearer ${token}` },
            }),
        );
        expect(forbidden.status).toBe(403);
        expect(
          ApiGatewayErrorResponseSchema.parse(await forbidden.json()).error
            .code,
        ).toBe('FORBIDDEN');
      },
    );
  });

  it('limits requests per client and includes retry guidance', async () => {
    await withServer(
      createApp({
        credentials: [readCredential],
        rateLimit: { maxRequests: 1, windowMs: 60_000 },
      }),
      async (baseUrl) => {
        const headers = { authorization: `Bearer ${token}` };
        expect(
          (await fetch(`${baseUrl}/api/v1/session`, { headers })).status,
        ).toBe(200);
        const limited = await fetch(`${baseUrl}/api/v1/session`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: '{invalid json',
        });
        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(
          ApiGatewayErrorResponseSchema.parse(await limited.json()).error.code,
        ).toBe('RATE_LIMITED');
      },
    );
  });
});

describe('transaction-bound audit event writer', () => {
  it('validates and writes bounded audit data through the supplied transaction', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'generated-event-id' });
    const transaction = {
      auditEvent: { create },
    } as unknown as Prisma.TransactionClient;

    await expect(
      writeAuditEvent(transaction, {
        eventType: 'incident.reviewed',
        targetType: 'Incident',
        targetId: '6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0',
        actorId: 'analyst-7',
        metadata: { reason: 'Reviewed', synthetic: true },
      }),
    ).resolves.toEqual({ id: 'generated-event-id' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'incident.reviewed',
          targetId: '6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0',
          actorId: 'analyst-7',
          metadata: { reason: 'Reviewed', synthetic: true },
        }),
        select: { id: true },
      }),
    );
  });

  it('rejects invalid audit data before issuing a database write', async () => {
    const create = vi.fn();
    const transaction = {
      auditEvent: { create },
    } as unknown as Prisma.TransactionClient;

    await expect(
      writeAuditEvent(transaction, {
        eventType: 'x'.repeat(121),
        targetType: 'Incident',
        targetId: 'not-a-uuid',
        actorId: 'analyst-7',
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects oversized audit metadata before issuing a database write', async () => {
    const create = vi.fn();
    const transaction = {
      auditEvent: { create },
    } as unknown as Prisma.TransactionClient;

    await expect(
      writeAuditEvent(transaction, {
        eventType: 'incident.reviewed',
        targetType: 'Incident',
        targetId: '6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0',
        actorId: 'analyst-7',
        metadata: { detail: 'x'.repeat(8_200) },
      }),
    ).rejects.toThrow(/size limit/);
    expect(create).not.toHaveBeenCalled();
  });
});
