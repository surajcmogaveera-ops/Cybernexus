import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

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
const writerToken = 'phase-nine-database-writer-token-32-chars';
const alertIds = [randomUUID(), randomUUID()].sort();
const correlationKey = createHash('sha256')
  .update(`incident:correlation:v1:${alertIds.join(':')}`)
  .digest('hex');
const alreadyLinkedAlertId = randomUUID();
const testAlertIds = [...alertIds, alreadyLinkedAlertId];
const actorId = `phase9-integration:${randomUUID()}`;
const userValue = `phase9-user-${randomUUID()}`;
const observedAt = new Date('2026-10-28T08:15:00.000Z');

databaseDescribe('correlation and incident PostgreSQL integration', () => {
  let prisma: PrismaClient;
  let server: Server;
  let baseUrl: string;
  const incidentIds: string[] = [];
  const relationshipIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$connect();

    const alerts = testAlertIds.map((id) => ({
      id,
      source: `phase9-${actorId}`,
      externalId: id,
      title: 'Synthetic shared-account activity',
      severity: 'high' as const,
      observedAt,
      payload: { synthetic: true },
      normalizedAttributes: { userId: userValue },
    }));
    await prisma.securityAlert.createMany({ data: alerts });

    const app = createApp({
      database: prisma,
      credentials: [
        {
          token: writerToken,
          subject: actorId,
          scopes: ['api:write', 'api:read'],
        },
      ],
      correlationService: {
        correlate: async (request) => {
          const [source, target] = request.alerts;
          const sourceUser = source?.entities.find(
            ({ entityType }) => entityType === 'user',
          );
          const targetUser = target?.entities.find(
            ({ entityType }) => entityType === 'user',
          );
          const sharedUser =
            sourceUser &&
            targetUser &&
            sourceUser.value.toLocaleLowerCase('en-US') ===
              targetUser.value.toLocaleLowerCase('en-US');
          return {
            contractVersion: 'v1',
            requestId: request.requestId,
            relationships: sharedUser
              ? [
                  {
                    sourceAlertId: source.id,
                    targetAlertId: target.id,
                    relationshipType: 'shared_user',
                    confidence: 0.9,
                    rationale:
                      'Both alerts share a normalized user or account identifier, and their event times are within the configured 120-minute review window. This is a candidate relationship, not a confirmed attack.',
                    evidence: [
                      {
                        entityType: 'user',
                        sourceField: sourceUser.fieldPath,
                        targetField: targetUser.fieldPath,
                      },
                    ],
                    status: 'proposed',
                  },
                ]
              : [],
          };
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
    if (!prisma) return;
    try {
      const linkedIncidents = await prisma.incidentAlert.findMany({
        where: { alertId: { in: testAlertIds } },
        select: { incidentId: true },
      });
      const cleanupIncidentIds = [
        ...new Set([
          ...incidentIds,
          ...linkedIncidents.map(({ incidentId }) => incidentId),
        ]),
      ];
      await prisma.alertRelationship.deleteMany({
        where: {
          OR: [
            { id: { in: relationshipIds } },
            { sourceAlertId: { in: testAlertIds } },
            { targetAlertId: { in: testAlertIds } },
          ],
        },
      });
      if (cleanupIncidentIds.length) {
        await prisma.incidentAlert.deleteMany({
          where: { incidentId: { in: cleanupIncidentIds } },
        });
        await prisma.incident.deleteMany({
          where: { id: { in: cleanupIncidentIds } },
        });
      }
      await prisma.auditEvent.deleteMany({ where: { actorId } });
      await prisma.alertEntity.deleteMany({
        where: { alertId: { in: testAlertIds } },
      });
      await prisma.securityAlert.deleteMany({
        where: { id: { in: testAlertIds } },
      });
      await prisma.entity.deleteMany({
        where: { entityType: 'user', value: userValue.toLowerCase() },
      });
    } finally {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    }
  });

  it('persists an explained relationship and incident idempotently, then serves the incident API', async () => {
    const run = async () =>
      fetch(`${baseUrl}/correlation/run`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${writerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ alertIds }),
      });
    const firstResponse = await run();
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      requestId: string;
      relationships: { id: string; status: string; evidence: unknown[] }[];
      incidents: {
        id: string;
        needsHumanReview: boolean;
        alertIds: string[];
      }[];
    };
    expect(first.relationships).toHaveLength(1);
    expect(first.relationships[0]).toMatchObject({ status: 'proposed' });
    expect(first.relationships[0]?.evidence).toHaveLength(1);
    expect(first.incidents).toHaveLength(1);
    expect(first.incidents[0]).toMatchObject({
      needsHumanReview: true,
      alertIds,
    });
    relationshipIds.push(first.relationships[0]!.id);
    incidentIds.push(first.incidents[0]!.id);

    const secondResponse = await run();
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as typeof first;
    expect(second.relationships[0]?.id).toBe(first.relationships[0]?.id);
    expect(second.incidents[0]?.id).toBe(first.incidents[0]?.id);

    const concurrentResponses = await Promise.all([run(), run()]);
    expect(concurrentResponses.map(({ status }) => status)).toEqual([200, 200]);
    const concurrentResults = await Promise.all(
      concurrentResponses.map(
        async (response) => (await response.json()) as typeof first,
      ),
    );
    expect(concurrentResults.map(({ incidents }) => incidents[0]?.id)).toEqual([
      first.incidents[0]?.id,
      first.incidents[0]?.id,
    ]);
    expect(
      await prisma.alertRelationship.count({
        where: { sourceAlertId: alertIds[0], targetAlertId: alertIds[1] },
      }),
    ).toBe(1);
    expect(await prisma.incident.count({ where: { correlationKey } })).toBe(1);

    const detailResponse = await fetch(
      `${baseUrl}/incidents/${first.incidents[0]!.id}`,
      {
        headers: { authorization: `Bearer ${writerToken}` },
      },
    );
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      incident: { id: first.incidents[0]!.id, alertIds },
      alerts: [{ id: alertIds[0] }, { id: alertIds[1] }],
      relationships: [{ id: first.relationships[0]!.id, status: 'proposed' }],
    });

    const timelineResponse = await fetch(
      `${baseUrl}/incidents/${first.incidents[0]!.id}/timeline`,
      {
        headers: { authorization: `Bearer ${writerToken}` },
      },
    );
    expect(timelineResponse.status).toBe(200);
    const timeline = (await timelineResponse.json()) as {
      items: { occurredAt: string; kind: string }[];
    };
    expect(timeline.items.map(({ occurredAt }) => occurredAt)).toEqual(
      [...timeline.items.map(({ occurredAt }) => occurredAt)].sort(),
    );

    const graphResponse = await fetch(
      `${baseUrl}/incidents/${first.incidents[0]!.id}/graph`,
      {
        headers: { authorization: `Bearer ${writerToken}` },
      },
    );
    expect(graphResponse.status).toBe(200);
    expect(await graphResponse.json()).toMatchObject({
      incidentId: first.incidents[0]!.id,
      nodes: expect.arrayContaining([
        expect.objectContaining({ type: 'entity', entityType: 'user' }),
      ]),
      edges: expect.arrayContaining([
        expect.objectContaining({
          type: 'correlation',
          relationshipStatus: 'proposed',
        }),
        expect.objectContaining({ type: 'alert_entity' }),
      ]),
    });

    const relationshipReview = await fetch(
      `${baseUrl}/relationships/${first.relationships[0]!.id}/status`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${writerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'accepted' }),
      },
    );
    expect(relationshipReview.status).toBe(200);
    expect(await relationshipReview.json()).toMatchObject({
      id: first.relationships[0]!.id,
      status: 'accepted',
    });
    const repeatedRelationshipDecision = await fetch(
      `${baseUrl}/relationships/${first.relationships[0]!.id}/status`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${writerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'rejected' }),
      },
    );
    expect(repeatedRelationshipDecision.status).toBe(409);

    const statusChange = await fetch(
      `${baseUrl}/incidents/${first.incidents[0]!.id}/status`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${writerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'triaged' }),
      },
    );
    expect(statusChange.status).toBe(200);
    expect(await statusChange.json()).toMatchObject({
      incident: { id: first.incidents[0]!.id, status: 'triaged' },
    });
    const invalidIncidentTransition = await fetch(
      `${baseUrl}/incidents/${first.incidents[0]!.id}/status`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${writerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'closed' }),
      },
    );
    expect(invalidIncidentTransition.status).toBe(409);

    const updatedTimelineResponse = await fetch(
      `${baseUrl}/incidents/${first.incidents[0]!.id}/timeline`,
      { headers: { authorization: `Bearer ${writerToken}` } },
    );
    expect(updatedTimelineResponse.status).toBe(200);
    const updatedTimeline = (await updatedTimelineResponse.json()) as {
      items: { kind: string }[];
    };
    expect(updatedTimeline.items.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        'incident_created',
        'alert_observed',
        'relationship_proposed',
        'relationship_reviewed',
        'status_changed',
      ]),
    );

    const listResponse = await fetch(`${baseUrl}/incidents`, {
      headers: { authorization: `Bearer ${writerToken}` },
    });
    expect(listResponse.status).toBe(200);
    const listedIncidents = (await listResponse.json()) as {
      items: { id: string; status: string }[];
    };
    expect(listedIncidents.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.incidents[0]!.id,
          status: 'triaged',
        }),
      ]),
    );

    const auditCount = await prisma.auditEvent.count({
      where: {
        actorId,
        eventType: {
          in: [
            'incident.created',
            'correlation.relationship_proposed',
            'incident.status_changed',
            'correlation.relationship.status_changed',
          ],
        },
      },
    });
    expect(auditCount).toBe(4);
    const persistedLinkCount = await prisma.incidentAlert.count({
      where: { incidentId: first.incidents[0]!.id },
    });
    expect(persistedLinkCount).toBe(2);

    const alreadyLinkedResponse = await fetch(`${baseUrl}/correlation/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ alertIds: [alertIds[0]!, alreadyLinkedAlertId] }),
    });
    expect(alreadyLinkedResponse.status).toBe(200);
    const alreadyLinked = (await alreadyLinkedResponse.json()) as {
      relationships: { id: string; status: string }[];
      incidents: unknown[];
      alertsRequiringReview: string[];
    };
    expect(alreadyLinked.relationships).toHaveLength(1);
    expect(alreadyLinked.relationships[0]?.status).toBe('review_required');
    expect(alreadyLinked.incidents).toEqual([]);
    expect(alreadyLinked.alertsRequiringReview).toEqual(
      [alertIds[0]!, alreadyLinkedAlertId].sort(),
    );
    expect(
      await prisma.incidentAlert.count({
        where: { alertId: alreadyLinkedAlertId },
      }),
    ).toBe(0);
  }, 30_000);
});
