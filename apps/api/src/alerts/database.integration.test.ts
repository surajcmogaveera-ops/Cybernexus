import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createPrismaAlertRepository } from './repository.js';

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

databaseDescribe('alert ingestion PostgreSQL integration', () => {
  const writerToken = 'integration-writer-token-with-at-least-32-chars';
  const readerToken = 'integration-reader-token-with-at-least-32-chars';
  const source = `integration-${randomUUID()}`;
  const sourceEventId = `event-${randomUUID()}`;
  const records: string[] = [];
  let prisma: import('@prisma/client').PrismaClient;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$connect();
    const database = prisma;

    const app = createApp({
      credentials: [
        {
          token: writerToken,
          subject: 'integration:writer',
          scopes: ['api:read', 'api:write', 'audit:write'],
        },
        {
          token: readerToken,
          subject: 'integration:reader',
          scopes: ['api:read'],
        },
      ],
      alertRepository: createPrismaAlertRepository(database),
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
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    if (prisma) {
      const createdAlerts = await prisma.securityAlert.findMany({
        where: { source },
        select: { id: true },
      });
      await prisma.auditEvent.deleteMany({
        where: {
          targetType: 'SecurityAlert',
          targetId: { in: createdAlerts.map(({ id }) => id) },
        },
      });
      await prisma.securityAlert.deleteMany({
        where: { source },
      });
      await prisma.$disconnect();
    }
  });

  it('persists normalized records, exact retries, conflicts, and duplicate ID-less events', async () => {
    const record = {
      source,
      externalId: sourceEventId,
      alertType: 'AUTHENTICATION',
      observedAt: '2026-10-29T13:45:00+05:30',
      title: 'Synthetic concurrent retry test',
      severity: 'warning',
      payload: {
        userId: 'integration-user',
        hostId: 'integration-host',
        note: 'Keep raw provider data intact.',
      },
    };
    const post = (body: unknown, idempotencyKey?: string) =>
      fetch(`${baseUrl}/ingest`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${writerToken}`,
          'content-type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });

    const concurrent = await Promise.all([post(record), post(record)]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    const firstBody = await concurrent[0]!.json();
    const secondBody = await concurrent[1]!.json();
    const accepted = [firstBody, secondBody].find(
      (body) => (body as { status: string }).status === 'accepted',
    ) as { alert: { id: string; observedAt: string; payload: unknown } };
    const acceptedId = accepted.alert.id;
    records.push(acceptedId);
    expect(accepted.alert.observedAt).toBe('2026-10-29T08:15:00.000Z');
    expect(accepted.alert.payload).toEqual(record.payload);

    const stored = await prisma.securityAlert.findUniqueOrThrow({
      where: { id: acceptedId },
    });
    expect(stored.sourceMetadata).toMatchObject({
      inputSource: source,
      inputExternalId: sourceEventId,
      inputTitle: record.title,
      inputSeverity: 'warning',
      inputObservedAt: '2026-10-29T13:45:00+05:30',
      externalIdProvided: true,
    });
    expect(stored.normalizedAttributes).toEqual({
      userId: 'integration-user',
      deviceId: 'integration-host',
    });

    const conflict = await post({ ...record, title: 'Changed retry content' });
    expect(conflict.status).toBe(409);

    const idless = {
      source,
      title: 'Distinct event without a source ID',
      observedAt: '2026-10-29T08:18:00Z',
      severity: 'low',
      payload: { synthetic: true },
    };
    const idlessResponses = await Promise.all([post(idless), post(idless)]);
    expect(idlessResponses.map((response) => response.status)).toEqual([
      201, 201,
    ]);
    for (const response of idlessResponses) {
      const body = (await response.json()) as { alert: { id: string } };
      records.push(body.alert.id);
    }
    expect(new Set(records.slice(1)).size).toBe(2);

    const retryableIdless = {
      source,
      title: 'Source event without its own ID but with client idempotency',
      observedAt: '2026-10-29T08:19:00Z',
      severity: 'medium',
      payload: { synthetic: true, retryable: true },
    };
    const idempotentResponses = await Promise.all([
      post(retryableIdless, 'retry-without-source-id-001'),
      post(retryableIdless, 'retry-without-source-id-001'),
    ]);
    expect(
      idempotentResponses.map((response) => response.status).sort(),
    ).toEqual([200, 201]);
    const acceptedIdempotentBody = (await idempotentResponses
      .find((response) => response.status === 201)!
      .json()) as { alert: { id: string } };
    records.push(acceptedIdempotentBody.alert.id);

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        targetType: 'SecurityAlert',
        targetId: { in: records },
      },
      orderBy: { eventType: 'asc' },
    });
    expect(auditEvents.map(({ eventType }) => eventType)).toContain(
      'alert.ingest.accepted',
    );
    expect(auditEvents.map(({ eventType }) => eventType)).toContain(
      'alert.ingest.duplicate',
    );
    expect(auditEvents.map(({ eventType }) => eventType)).toContain(
      'alert.ingest.conflict',
    );

    const listed = await fetch(
      `${baseUrl}?source=${encodeURIComponent(source)}&pageSize=2`,
      {
        headers: { authorization: `Bearer ${readerToken}` },
      },
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      page: 1,
      pageSize: 2,
      totalItems: 4,
      items: expect.arrayContaining([
        expect.objectContaining({ source, severity: 'medium' }),
      ]),
    });
  }, 30_000);
});
