import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const testDatabaseUrl = process.env.CYBERNEXUS_TEST_DATABASE_URL;
if (testDatabaseUrl) {
  const parsed = new URL(testDatabaseUrl);
  if (
    !['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname) ||
    parsed.pathname !== '/cybernexus_test'
  ) {
    throw new Error(
      'CYBERNEXUS_TEST_DATABASE_URL must point to local cybernexus_test.',
    );
  }
}

const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const incidentId = randomUUID();
const alertIds = [randomUUID(), randomUUID()];
const relationshipId = randomUUID();
const writerToken = 'phase-eleven-writer-token-32-characters';
const readerToken = 'phase-eleven-reader-token-32-characters';
const auditorToken = 'phase-eleven-auditor-token-32-characters';
const actorId = `phase11:${randomUUID()}`;

databaseDescribe('prioritization and audit PostgreSQL integration', () => {
  let prisma: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let rejectAuditWrites = false;
  let setAuditWriteFailure: (value: boolean) => void;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$connect();
    setAuditWriteFailure = (value) => {
      rejectAuditWrites = value;
    };
    const database = new Proxy(prisma, {
      get(target, property) {
        if (property === '$transaction') {
          return (callback: (transaction: unknown) => Promise<unknown>) =>
            target.$transaction((transaction) =>
              callback(
                new Proxy(transaction, {
                  get(transactionTarget, transactionProperty) {
                    if (transactionProperty === 'auditEvent') {
                      const delegate = Reflect.get(
                        transactionTarget,
                        transactionProperty,
                      );
                      return new Proxy(delegate, {
                        get(delegateTarget, delegateProperty) {
                          if (
                            delegateProperty === 'create' &&
                            rejectAuditWrites
                          ) {
                            return async () => {
                              throw new Error(
                                'synthetic audit persistence failure',
                              );
                            };
                          }
                          return Reflect.get(delegateTarget, delegateProperty);
                        },
                      });
                    }
                    return Reflect.get(transactionTarget, transactionProperty);
                  },
                }),
              ),
            );
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as PrismaClient;

    await prisma.securityAlert.createMany({
      data: alertIds.map((id, index) => ({
        id,
        source: `phase11-${actorId}`,
        externalId: id,
        title: `Synthetic response planning alert ${index + 1}`,
        alertType: 'authentication',
        severity: 'high',
        observedAt: new Date('2026-10-29T08:00:00.000Z'),
        payload: { synthetic: true },
        normalizedAttributes: { syntheticCase: actorId },
      })),
    });
    await prisma.incident.create({
      data: {
        id: incidentId,
        title: 'Synthetic Phase 11 priority incident',
        severity: 'high',
        status: 'new',
        needsHumanReview: true,
        alertLinks: { create: alertIds.map((alertId) => ({ alertId })) },
      },
    });
    await prisma.alertRelationship.create({
      data: {
        id: relationshipId,
        correlationKey: randomUUID()
          .replaceAll('-', '')
          .padEnd(64, '0')
          .slice(0, 64),
        sourceAlertId: alertIds[0]!,
        targetAlertId: alertIds[1]!,
        relationshipType: 'shared_ip',
        confidence: 0.55,
        rationale: 'Synthetic candidate relationship for analyst review.',
        evidence: [
          {
            entityType: 'ip',
            sourceField: 'payload.sourceIp',
            targetField: 'payload.sourceIp',
          },
        ],
        status: 'review_required',
      },
    });

    const app = createApp({
      database,
      credentials: [
        { token: writerToken, subject: actorId, scopes: ['api:write'] },
        {
          token: readerToken,
          subject: `${actorId}:reader`,
          scopes: ['api:read'],
        },
        {
          token: auditorToken,
          subject: `${actorId}:auditor`,
          scopes: ['audit:read'],
        },
      ],
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/incidents/${incidentId}`;
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.auditEvent.deleteMany({ where: { actorId } });
      await prisma.incidentPriorityCalculation.deleteMany({
        where: { incidentId },
      });
      await prisma.incident.updateMany({
        where: { id: incidentId },
        data: {
          priorityOverride: null,
          priorityOverrideReason: null,
          priorityOverrideActorId: null,
          priorityOverrideAt: null,
        },
      });
      await prisma.incidentAlert.deleteMany({ where: { incidentId } });
      await prisma.alertRelationship.deleteMany({
        where: { id: relationshipId },
      });
      await prisma.incident.deleteMany({ where: { id: incidentId } });
      await prisma.securityAlert.deleteMany({
        where: { id: { in: alertIds } },
      });
    } finally {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    }
  });

  it('calculates, persists, retrieves, and explains risk, SLA, and grounded recommendations', async () => {
    const absent = await fetch(`${baseUrl}/priority`, {
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(absent.status).toBe(404);
    const invalidBody = await fetch(`${baseUrl}/priority/recalculate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ severity: 'critical' }),
    });
    expect(invalidBody.status).toBe(400);
    const created = await fetch(`${baseUrl}/priority/recalculate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${writerToken}` },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      priority: Record<string, unknown>;
    };
    expect(body.priority).toMatchObject({
      incidentId,
      severity: 'high',
      riskScore: 60,
      recommendedPriority: 'medium',
      effectivePriority: 'medium',
      policyVersion: 'risk-v1',
    });
    expect(
      (body.priority.factors as { factor: string }[]).map(
        ({ factor }) => factor,
      ),
    ).toContain('review_required_relationship');

    const retrieved = await fetch(`${baseUrl}/priority`, {
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toMatchObject({ priority: body.priority });

    const sla = await fetch(`${baseUrl}/sla`, {
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(sla.status).toBe(200);
    expect(await sla.json()).toMatchObject({
      sla: { responseTargetMinutes: 240, state: 'on_track' },
    });

    const breachRisk = await fetch(`${baseUrl}/breach-risk`, {
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(await breachRisk.json()).toMatchObject({
      breachRisk: { band: 'low', predictiveModel: false },
    });

    const planForbidden = await fetch(`${baseUrl}/response-plan`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(planForbidden.status).toBe(403);
    const plan = await fetch(`${baseUrl}/response-plan`, {
      method: 'POST',
      headers: { authorization: `Bearer ${writerToken}` },
    });
    const planBody = (await plan.json()) as {
      responsePlan: {
        steps: {
          action: string;
          status: string;
          approvalStatus: string;
          performed: boolean;
          evidence: { kind: string; id: string }[];
        }[];
      };
    };
    expect(planBody.responsePlan.steps).toHaveLength(4);
    expect(planBody.responsePlan.steps[0]!.evidence).toEqual(
      [...alertIds].sort().map((id) => ({ kind: 'alert', id })),
    );
    expect(planBody.responsePlan.steps[1]!.action).toContain(
      'identity provider',
    );
    expect(planBody.responsePlan.steps[2]!.evidence).toEqual([
      { kind: 'relationship', id: relationshipId },
    ]);
    expect(planBody.responsePlan.steps[3]!.action).toContain(
      'response playbook',
    );
    expect(
      planBody.responsePlan.steps.every(
        ({ status, approvalStatus, performed }) =>
          status === 'suggested' &&
          approvalStatus === 'review_required' &&
          !performed,
      ),
    ).toBe(true);
    expect(
      await prisma.auditEvent.count({
        where: {
          actorId,
          eventType: 'incident.response_step.suggested',
          targetId: incidentId,
        },
      }),
    ).toBe(4);
  }, 30_000);

  it('requires authorization and reason for priority overrides and exposes bounded audit history', async () => {
    const invalid = await fetch(`${baseUrl}/priority/override`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ priority: 'critical', reason: 'short' }),
    });
    expect(invalid.status).toBe(400);
    const forbidden = await fetch(`${baseUrl}/priority/override`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${readerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        priority: 'critical',
        reason: 'Analyst confirmed escalation.',
      }),
    });
    expect(forbidden.status).toBe(403);
    const override = await fetch(`${baseUrl}/priority/override`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        priority: 'critical',
        reason: 'Analyst confirmed escalation.',
      }),
    });
    expect(override.status).toBe(200);
    expect(await override.json()).toMatchObject({
      override: {
        previousOverride: null,
        priorityOverride: 'critical',
        actorId,
        reason: 'Analyst confirmed escalation.',
      },
    });
    const current = await fetch(`${baseUrl}/priority`, {
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(await current.json()).toMatchObject({
      priority: {
        recommendedPriority: 'medium',
        effectivePriority: 'critical',
        riskScore: 60,
      },
    });

    const forbiddenAudit = await fetch(`${baseUrl}/audit`, {
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(forbiddenAudit.status).toBe(403);
    const audit = await fetch(`${baseUrl}/audit?page=1&pageSize=10`, {
      headers: { authorization: `Bearer ${auditorToken}` },
    });
    expect(audit.status).toBe(200);
    const badPage = await fetch(`${baseUrl}/audit?page=101`, {
      headers: { authorization: `Bearer ${auditorToken}` },
    });
    expect(badPage.status).toBe(400);
    expect(await audit.json()).toMatchObject({
      incidentId,
      page: 1,
      items: expect.arrayContaining([
        expect.objectContaining({
          eventType: 'incident.priority.overridden',
          actorId,
          metadata: expect.objectContaining({
            fromPriority: 'medium',
            toPriority: 'critical',
            reason: 'Analyst confirmed escalation.',
          }),
        }),
        expect.objectContaining({
          eventType: 'incident.response_step.suggested',
          actorId,
          metadata: expect.objectContaining({
            status: 'suggested',
            approvalStatus: 'review_required',
            performed: false,
            evidenceReferences: expect.any(String),
          }),
        }),
      ]),
    });
  });

  it('rolls back a priority calculation when its transaction-bound audit write fails', async () => {
    const before = await prisma.incidentPriorityCalculation.count({
      where: { incidentId },
    });
    setAuditWriteFailure(true);
    try {
      const response = await fetch(`${baseUrl}/priority/recalculate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${writerToken}` },
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(
        'synthetic audit persistence failure',
      );
    } finally {
      setAuditWriteFailure(false);
    }
    expect(
      await prisma.incidentPriorityCalculation.count({ where: { incidentId } }),
    ).toBe(before);
  });
});
