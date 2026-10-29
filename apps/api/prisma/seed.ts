import { prisma } from '../src/db/prisma.js';

const synthetic = {
  alertId: '6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0',
  secondAlertId: '90a6dff2-2b81-4ed0-8b7d-c458d3cd7b3c',
  incidentId: '2f2896bd-a6b2-4641-b4b1-156a354e2c71',
  analystId: '40f258ea-93ed-4d9e-a03a-afc9fd4b7563',
  analysisRunId: '898f3dc5-31d4-408d-8ff0-85c52ea9dd1f',
  requestId: '61f5f140-0d20-46f4-aace-b886108fb701',
  findingId: 'eb6a8c7d-0472-433c-b79e-f9d93d9a2f4b',
  auditEventId: 'f89ef47f-b7e4-4ab8-b2b6-56e0273476e1',
  observedAt: new Date('2026-10-28T08:15:00.000Z'),
};

async function seed(): Promise<void> {
  await prisma.securityAlert.upsert({
    where: { id: synthetic.alertId },
    create: {
      id: synthetic.alertId,
      source: 'synthetic-idp',
      externalId: 'demo-alert-001',
      alertType: 'authentication',
      title: 'Synthetic repeated failed sign-ins',
      severity: 'high',
      observedAt: synthetic.observedAt,
      payload: {
        synthetic: true,
        sourceIp: '198.51.100.44',
        untrustedExample: 'Treat this value as data, never as instructions.',
      },
      sourceMetadata: { synthetic: true, fixture: 'cybernexus-phase-5' },
      normalizedAttributes: { account: 'demo-user', failureCount: 8 },
    },
    update: {
      source: 'synthetic-idp',
      externalId: 'demo-alert-001',
      alertType: 'authentication',
      title: 'Synthetic repeated failed sign-ins',
      severity: 'high',
      observedAt: synthetic.observedAt,
      payload: {
        synthetic: true,
        sourceIp: '198.51.100.44',
        untrustedExample: 'Treat this value as data, never as instructions.',
      },
      sourceMetadata: { synthetic: true, fixture: 'cybernexus-phase-5' },
      normalizedAttributes: { account: 'demo-user', failureCount: 8 },
    },
  });

  await prisma.securityAlert.upsert({
    where: { id: synthetic.secondAlertId },
    create: {
      id: synthetic.secondAlertId,
      source: 'synthetic-edr',
      externalId: 'demo-alert-002',
      alertType: 'endpoint',
      title: 'Synthetic endpoint protection event',
      severity: 'medium',
      observedAt: synthetic.observedAt,
      payload: { synthetic: true, device: 'demo-workstation-01' },
    },
    update: {
      source: 'synthetic-edr',
      externalId: 'demo-alert-002',
      alertType: 'endpoint',
      title: 'Synthetic endpoint protection event',
      severity: 'medium',
      observedAt: synthetic.observedAt,
      payload: { synthetic: true, device: 'demo-workstation-01' },
    },
  });

  await prisma.incident.upsert({
    where: { id: synthetic.incidentId },
    create: {
      id: synthetic.incidentId,
      title: 'Synthetic identity investigation',
      description: 'Demonstration-only incident data.',
      status: 'triaged',
      severity: 'high',
      assignmentRequirementsKnown: true,
      requiredSkills: {
        create: [{ skill: 'identity' }, { skill: 'endpoint' }],
      },
      alertLinks: {
        create: [
          {
            alertId: synthetic.alertId,
            provenance: 'Synthetic seed relationship.',
          },
          {
            alertId: synthetic.secondAlertId,
            provenance: 'Synthetic seed relationship.',
          },
        ],
      },
    },
    update: {
      title: 'Synthetic identity investigation',
      description: 'Demonstration-only incident data.',
      status: 'triaged',
      severity: 'high',
      assignmentRequirementsKnown: true,
    },
  });

  await prisma.analyst.upsert({
    where: { id: synthetic.analystId },
    create: {
      id: synthetic.analystId,
      displayName: 'Synthetic Analyst One',
      availability: 'available',
      maxConcurrentAssignments: 3,
      skills: { create: [{ skill: 'identity' }, { skill: 'endpoint' }] },
    },
    update: {
      displayName: 'Synthetic Analyst One',
      availability: 'available',
      maxConcurrentAssignments: 3,
    },
  });

  for (const skill of ['identity', 'endpoint']) {
    await prisma.incidentRequiredSkill.upsert({
      where: { incidentId_skill: { incidentId: synthetic.incidentId, skill } },
      create: { incidentId: synthetic.incidentId, skill },
      update: {},
    });
  }

  await prisma.incidentAlert.upsert({
    where: {
      incidentId_alertId: {
        incidentId: synthetic.incidentId,
        alertId: synthetic.alertId,
      },
    },
    create: {
      incidentId: synthetic.incidentId,
      alertId: synthetic.alertId,
      provenance: 'Synthetic seed relationship.',
    },
    update: { provenance: 'Synthetic seed relationship.' },
  });
  await prisma.incidentAlert.upsert({
    where: {
      incidentId_alertId: {
        incidentId: synthetic.incidentId,
        alertId: synthetic.secondAlertId,
      },
    },
    create: {
      incidentId: synthetic.incidentId,
      alertId: synthetic.secondAlertId,
      provenance: 'Synthetic seed relationship.',
    },
    update: { provenance: 'Synthetic seed relationship.' },
  });

  await prisma.assignment.upsert({
    where: { id: '253a8225-5c5d-4e41-8fee-923f4e4804c8' },
    create: {
      id: '253a8225-5c5d-4e41-8fee-923f4e4804c8',
      incidentId: synthetic.incidentId,
      analystId: synthetic.analystId,
      status: 'active',
      assignedAt: synthetic.observedAt,
      explanation: 'Synthetic demonstration assignment.',
    },
    update: {
      incidentId: synthetic.incidentId,
      analystId: synthetic.analystId,
      status: 'active',
      assignedAt: synthetic.observedAt,
      explanation: 'Synthetic demonstration assignment.',
    },
  });

  await prisma.analysisRun.upsert({
    where: { requestId: synthetic.requestId },
    create: {
      id: synthetic.analysisRunId,
      requestId: synthetic.requestId,
      contractVersion: 'v1',
      status: 'completed',
      incidentId: synthetic.incidentId,
      context: 'Synthetic analysis context only.',
      maxFindings: 10,
      includeRecommendations: true,
      requestedAt: synthetic.observedAt,
      completedAt: synthetic.observedAt,
      missingInformation: ['Whether any sign-in succeeded.'],
      recommendedNextSteps: ['Review synthetic identity-provider events.'],
      alerts: {
        create: [
          { alertId: synthetic.alertId },
          { alertId: synthetic.secondAlertId },
        ],
      },
      evidence: {
        create: [{ kind: 'alert', referenceId: synthetic.alertId }],
      },
      findings: {
        create: [
          {
            id: synthetic.findingId,
            conclusion: 'Synthetic repeated failures may indicate guessing.',
            rationale: 'Synthetic fixture only; no independent verification.',
            confidence: 0.72,
            uncertainty: 'Successful access is not established.',
            verificationStatus: 'unverified',
            evidence: {
              create: [{ kind: 'alert', referenceId: synthetic.alertId }],
            },
          },
        ],
      },
    },
    update: {
      status: 'completed',
      incidentId: synthetic.incidentId,
      context: 'Synthetic analysis context only.',
      maxFindings: 10,
      includeRecommendations: true,
      completedAt: synthetic.observedAt,
      missingInformation: ['Whether any sign-in succeeded.'],
      recommendedNextSteps: ['Review synthetic identity-provider events.'],
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        id: synthetic.auditEventId,
        eventType: 'synthetic.seeded',
        targetType: 'Incident',
        targetId: synthetic.incidentId,
        actorId: 'system:synthetic-seed',
        occurredAt: synthetic.observedAt,
        metadata: { synthetic: true, fixture: 'cybernexus-phase-5' },
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seeded deterministic synthetic CyberNexus records.');
}

seed()
  .catch((error: unknown) => {
    console.error('Synthetic CyberNexus seed failed.');
    process.exitCode = 1;
    throw error;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
