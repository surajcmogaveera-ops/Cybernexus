import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeAuditEvent } from '../audit/write-audit-event.js';

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

databaseDescribe('PostgreSQL persistence integration', () => {
  let prisma: import('@prisma/client').PrismaClient;
  const ids = {
    alert: randomUUID(),
    repeatedAlert: randomUUID(),
    missingExternalIdOne: randomUUID(),
    missingExternalIdTwo: randomUUID(),
    incident: randomUUID(),
    analyst: randomUUID(),
    assignmentOne: randomUUID(),
    assignmentTwo: randomUUID(),
    analysisRun: randomUUID(),
    request: randomUUID(),
    finding: randomUUID(),
    unresolvedReference: randomUUID(),
  };
  let auditEventId: string | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists payloads, associations, history, advisory evidence and audit events', async () => {
    const payload = {
      synthetic: true,
      text: 'Untrusted source text remains data.',
      nested: { attempt: 3 },
    };

    try {
      const alert = await prisma.securityAlert.create({
        data: {
          id: ids.alert,
          source: 'synthetic-idp',
          externalId: 'repeatable-source-id',
          title: 'Synthetic alert',
          severity: 'high',
          observedAt: new Date('2026-10-28T08:15:00.000Z'),
          payload,
        },
      });
      await prisma.securityAlert.create({
        data: {
          id: ids.repeatedAlert,
          source: alert.source,
          externalId: 'different-source-event-id',
          title: 'Legitimate distinct source event',
          severity: 'medium',
          observedAt: new Date('2026-10-28T08:16:00.000Z'),
          payload: { synthetic: true, repeat: 2 },
        },
      });
      await expect(
        prisma.securityAlert.create({
          data: {
            id: randomUUID(),
            source: alert.source,
            externalId: 'repeatable-source-id',
            title: 'Duplicate source event must not be inserted',
            severity: 'high',
            observedAt: alert.observedAt,
            payload,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await prisma.securityAlert.createMany({
        data: [ids.missingExternalIdOne, ids.missingExternalIdTwo].map(
          (id) => ({
            id,
            source: 'synthetic-no-source-id',
            title: 'Synthetic source has no event ID',
            severity: 'unknown',
            observedAt: new Date('2026-10-28T08:17:00.000Z'),
            payload: { synthetic: true },
          }),
        ),
      });

      const stored = await prisma.securityAlert.findUniqueOrThrow({
        where: { id: ids.alert },
      });
      expect(stored.payload).toEqual(payload);

      await prisma.incident.create({
        data: {
          id: ids.incident,
          title: 'Synthetic test incident',
          severity: 'high',
          needsHumanReview: true,
          alertLinks: { create: [{ alertId: ids.alert }] },
        },
      });
      const incident = await prisma.incident.findUniqueOrThrow({
        where: { id: ids.incident },
        include: { alertLinks: true },
      });
      expect(incident.needsHumanReview).toBe(true);
      expect(incident.alertLinks.map(({ alertId }) => alertId)).toEqual([
        ids.alert,
      ]);
      expect(
        await prisma.incident.update({
          where: { id: ids.incident },
          data: { needsHumanReview: false },
        }),
      ).toMatchObject({ needsHumanReview: false });
      expect(
        await prisma.incident.update({
          where: { id: ids.incident },
          data: { needsHumanReview: null },
        }),
      ).toMatchObject({ needsHumanReview: null });

      await expect(
        prisma.incidentAlert.create({
          data: { incidentId: ids.incident, alertId: ids.alert },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.incidentAlert.create({
          data: { incidentId: randomUUID(), alertId: ids.alert },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        prisma.securityAlert.delete({ where: { id: ids.alert } }),
      ).rejects.toThrow(/violates RESTRICT setting of foreign key constraint/);

      await prisma.analyst.create({
        data: {
          id: ids.analyst,
          displayName: 'Synthetic Integration Analyst',
          availability: 'available',
          skills: { create: [{ skill: 'identity' }] },
        },
      });
      await prisma.assignment.createMany({
        data: [
          {
            id: ids.assignmentOne,
            incidentId: ids.incident,
            analystId: ids.analyst,
            status: 'reassigned',
            explanation: 'Synthetic prior assignment.',
          },
          {
            id: ids.assignmentTwo,
            incidentId: ids.incident,
            analystId: ids.analyst,
            status: 'active',
            explanation: 'Synthetic current assignment.',
          },
        ],
      });
      expect(
        await prisma.assignment.count({ where: { incidentId: ids.incident } }),
      ).toBe(2);

      await prisma.analysisRun.create({
        data: {
          id: ids.analysisRun,
          requestId: ids.request,
          contractVersion: 'v1',
          status: 'completed',
          incidentId: ids.incident,
          alerts: { create: [{ alertId: ids.alert }] },
          evidence: {
            create: [{ kind: 'other', referenceId: ids.unresolvedReference }],
          },
          findings: {
            create: [
              {
                id: ids.finding,
                conclusion: 'Synthetic, unverified finding.',
                rationale: 'Evidence references do not prove a claim.',
                confidence: 0.5,
                verificationStatus: 'unverified',
                evidence: {
                  create: [
                    { kind: 'other', referenceId: ids.unresolvedReference },
                  ],
                },
              },
            ],
          },
        },
      });
      await expect(
        prisma.analysisRun.update({
          where: { id: ids.analysisRun },
          data: { maxFindings: 21 },
        }),
      ).rejects.toThrow(/violates check constraint/);
      await expect(
        prisma.analysisFinding.create({
          data: {
            analysisRunId: ids.analysisRun,
            conclusion: 'Invalid confidence test.',
            rationale: 'The database check must reject this value.',
            confidence: 1.1,
          },
        }),
      ).rejects.toThrow(/violates check constraint/);
      const persistedFinding = await prisma.analysisFinding.findUniqueOrThrow({
        where: { id: ids.finding },
        include: { evidence: true },
      });
      expect(persistedFinding.verificationStatus).toBe('unverified');
      expect(persistedFinding.evidence[0]?.referenceId).toBe(
        ids.unresolvedReference,
      );

      const auditEvent = await prisma.$transaction((transaction) =>
        writeAuditEvent(transaction, {
          eventType: 'synthetic.test',
          targetType: 'Incident',
          targetId: ids.incident,
          actorId: 'system:test',
          metadata: { synthetic: true },
        }),
      );
      auditEventId = auditEvent.id;
      expect(
        await prisma.auditEvent.findUniqueOrThrow({
          where: { id: auditEvent.id },
        }),
      ).toMatchObject({
        eventType: 'synthetic.test',
        metadata: { synthetic: true },
      });
    } finally {
      if (auditEventId) {
        await prisma.auditEvent.deleteMany({ where: { id: auditEventId } });
      }
      await prisma.analysisFindingEvidenceReference.deleteMany({
        where: { analysisFindingId: ids.finding },
      });
      await prisma.analysisFinding.deleteMany({ where: { id: ids.finding } });
      await prisma.analysisRunEvidenceReference.deleteMany({
        where: { analysisRunId: ids.analysisRun },
      });
      await prisma.analysisRunAlert.deleteMany({
        where: { analysisRunId: ids.analysisRun },
      });
      await prisma.analysisRun.deleteMany({ where: { id: ids.analysisRun } });
      await prisma.assignment.deleteMany({
        where: { id: { in: [ids.assignmentOne, ids.assignmentTwo] } },
      });
      await prisma.incidentAlert.deleteMany({
        where: { incidentId: ids.incident },
      });
      await prisma.incident.deleteMany({ where: { id: ids.incident } });
      await prisma.analystSkill.deleteMany({
        where: { analystId: ids.analyst },
      });
      await prisma.analyst.deleteMany({ where: { id: ids.analyst } });
      await prisma.securityAlert.deleteMany({
        where: {
          id: {
            in: [
              ids.alert,
              ids.repeatedAlert,
              ids.missingExternalIdOne,
              ids.missingExternalIdTwo,
            ],
          },
        },
      });
    }
  });
});
