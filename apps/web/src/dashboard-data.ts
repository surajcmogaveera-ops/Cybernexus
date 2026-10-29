import type {
  AlertSeverity,
  Analyst,
  Incident,
  SecurityAlert,
} from '@cybernexus/shared';

export type DemoAlert = SecurityAlert & {
  affectedEntities: { type: string; value: string; relationship: string }[];
};

export type DemoIncident = Incident & {
  description: string;
  alertIds: string[];
  assignedAnalystId?: string;
  riskRationale: string;
  evidenceStatus: 'reviewed' | 'partial' | 'missing';
  uncertainty: string;
  deadlineAt: string;
  timeline: { at: string; title: string; detail: string }[];
  missingEvidence: string[];
  suggestedSteps: string[];
};

export type DemoAssignment = {
  id: string;
  incidentId: string;
  analystId: string;
  status: 'active' | 'reassigned' | 'completed' | 'cancelled';
  assignedAt: string;
  explanation: string;
};

export type DashboardDataset = {
  incidents: DemoIncident[];
  alerts: DemoAlert[];
  analysts: (Analyst & { capacity: number; workload: number })[];
  assignments: DemoAssignment[];
  volume: { date: string; alerts: number; incidents: number }[];
  source: 'synthetic-demo';
};

const at = (time: string): string => `2026-10-29T${time}:00Z`;
const id = {
  alert1: '6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0',
  alert2: '90a6dff2-2b81-4ed0-8b7d-c458d3cd7b3c',
  alert3: 'b5b6617d-bd0a-4b57-8e46-59fca86d4c88',
  alert4: '01234567-89ab-4def-8123-456789abcdef',
  alert5: '12345678-9abc-4def-8123-456789abcdef',
  alert6: '23456789-abcd-4def-8123-456789abcdef',
  alert7: '3456789a-bcde-4def-8123-456789abcdef',
  incident1: '456789ab-cdef-4def-8123-456789abcdef',
  incident2: '56789abc-def0-4def-8123-456789abcdef',
  incident3: '6789abcd-ef01-4def-8123-456789abcdef',
  incident4: '789abcde-f012-4def-8123-456789abcdef',
  incident5: '89abcdef-0123-4def-8123-456789abcdef',
  analyst1: '9abcdef0-1234-4def-8123-456789abcdef',
  analyst2: 'abcdef01-2345-4def-8123-456789abcdef',
  analyst3: 'bcdef012-3456-4def-8123-456789abcdef',
  analyst4: 'cdef0123-4567-4def-8123-456789abcdef',
};

const alerts: DemoAlert[] = [
  {
    id: id.alert1,
    source: 'demo-idp',
    externalId: 'demo-alert-001',
    observedAt: at('08:15'),
    ingestedAt: at('08:16'),
    title: 'Repeated failed sign-ins followed by a successful login',
    severity: 'critical',
    payload: {
      synthetic: true,
      userId: 'analyst-demo@example.test',
      sourceIp: '198.51.100.44',
      failedAttempts: 8,
      result: 'success',
    },
    affectedEntities: [
      {
        type: 'User',
        value: 'analyst-demo@example.test',
        relationship: 'authenticated from',
      },
      {
        type: 'IP address',
        value: '198.51.100.44',
        relationship: 'observed source',
      },
    ],
  },
  {
    id: id.alert2,
    source: 'demo-edr',
    externalId: 'demo-alert-002',
    observedAt: at('08:19'),
    ingestedAt: at('08:20'),
    title: 'Unusual script interpreter launched by a document reader',
    severity: 'high',
    payload: {
      synthetic: true,
      hostId: 'demo-workstation-07',
      image: 'powershell.exe',
      parentImage: 'reader.exe',
    },
    affectedEntities: [
      {
        type: 'Host',
        value: 'demo-workstation-07',
        relationship: 'process executed on',
      },
      {
        type: 'Process',
        value: 'powershell.exe',
        relationship: 'child of reader.exe',
      },
    ],
  },
  {
    id: id.alert3,
    source: 'demo-cloud',
    externalId: 'demo-alert-003',
    observedAt: at('06:42'),
    ingestedAt: at('06:43'),
    title: 'Storage access policy changed outside maintenance window',
    severity: 'high',
    payload: {
      synthetic: true,
      actor: 'svc-demo-deploy',
      resource: 'demo-storage-prod',
      change: 'publicAccess=enabled',
    },
    affectedEntities: [
      {
        type: 'Service account',
        value: 'svc-demo-deploy',
        relationship: 'changed policy for',
      },
      {
        type: 'Cloud resource',
        value: 'demo-storage-prod',
        relationship: 'policy changed',
      },
    ],
  },
  {
    id: id.alert4,
    source: 'demo-edr',
    externalId: 'demo-alert-004',
    observedAt: at('05:31'),
    ingestedAt: at('05:32'),
    title: 'Endpoint protection detected quarantined payload',
    severity: 'critical',
    payload: {
      synthetic: true,
      hostId: 'demo-laptop-12',
      fileHash: 'sha256:demo-4a8f',
      action: 'quarantined',
    },
    affectedEntities: [
      {
        type: 'Host',
        value: 'demo-laptop-12',
        relationship: 'payload quarantined on',
      },
    ],
  },
  {
    id: id.alert5,
    source: 'demo-mail',
    externalId: 'demo-alert-005',
    observedAt: at('04:18'),
    ingestedAt: at('04:19'),
    title: 'Reported message contains a suspicious attachment',
    severity: 'medium',
    payload: {
      synthetic: true,
      user: 'finance-demo@example.test',
      attachment: 'invoice-review.docm',
      disposition: 'reported',
    },
    affectedEntities: [
      {
        type: 'User',
        value: 'finance-demo@example.test',
        relationship: 'reported message',
      },
    ],
  },
  {
    id: id.alert6,
    source: 'demo-idp',
    externalId: 'demo-alert-006',
    observedAt: at('03:52'),
    ingestedAt: at('03:53'),
    title: 'New authentication factor enrolled for privileged account',
    severity: 'medium',
    payload: {
      synthetic: true,
      user: 'admin-demo@example.test',
      factor: 'security-key',
      sourceIp: '203.0.113.19',
    },
    affectedEntities: [
      {
        type: 'User',
        value: 'admin-demo@example.test',
        relationship: 'enrolled new factor',
      },
    ],
  },
  {
    id: id.alert7,
    source: 'demo-network',
    externalId: 'demo-alert-007',
    observedAt: at('02:27'),
    ingestedAt: at('02:28'),
    title: 'Outbound connection to a newly observed domain',
    severity: 'low',
    payload: {
      synthetic: true,
      hostId: 'demo-build-03',
      domain: 'updates.example.test',
      action: 'allowed',
    },
    affectedEntities: [
      {
        type: 'Host',
        value: 'demo-build-03',
        relationship: 'connected to domain',
      },
    ],
  },
];

const incidents: DemoIncident[] = [
  {
    id: id.incident1,
    title: 'Possible identity compromise after repeated sign-in failures',
    description:
      'A synthetic identity-provider sequence shows repeated failures followed by a successful sign-in. Endpoint activity is temporally nearby; the relationship is a lead for analyst review, not proof of causation.',
    alertIds: [id.alert1, id.alert2],
    status: 'investigating',
    severity: 'critical',
    riskScore: 91,
    confidence: 0.76,
    needsHumanReview: true,
    createdAt: at('08:22'),
    updatedAt: at('08:41'),
    assignedAnalystId: id.analyst1,
    riskRationale:
      'Successful authentication followed eight failures; unusual child process observed on a separate demo host. Cross-source identity is not established.',
    evidenceStatus: 'partial',
    uncertainty:
      'The sign-in and endpoint activity are not linked to the same person or device in the available synthetic records.',
    deadlineAt: at('09:10'),
    timeline: [
      {
        at: at('08:15'),
        title: 'Eight sign-in failures',
        detail:
          'demo-idp observed failures for analyst-demo@example.test from 198.51.100.44.',
      },
      {
        at: at('08:16'),
        title: 'Successful sign-in',
        detail:
          'The provider sample records a success; session and MFA context are not included.',
      },
      {
        at: at('08:19'),
        title: 'Unusual process start',
        detail:
          'demo-edr saw powershell.exe launched by reader.exe on demo-workstation-07.',
      },
      {
        at: at('08:41'),
        title: 'Analyst review requested',
        detail: 'Synthetic incident marked for human review.',
      },
    ],
    missingEvidence: [
      'Session identifier and MFA outcome',
      'Endpoint-to-user attribution',
      'Device sign-in history',
    ],
    suggestedSteps: [
      'Confirm the successful session with the identity provider.',
      'Check endpoint ownership and process ancestry.',
      'Preserve relevant authentication and endpoint records.',
    ],
  },
  {
    id: id.incident2,
    title: 'Cloud storage exposure policy change',
    description:
      'A synthetic cloud event records a public-access policy change by a service account outside the listed maintenance window.',
    alertIds: [id.alert3],
    status: 'triaged',
    severity: 'high',
    riskScore: 78,
    confidence: 0.83,
    needsHumanReview: true,
    createdAt: at('06:48'),
    updatedAt: at('07:02'),
    assignedAnalystId: id.analyst2,
    riskRationale:
      'Public access was enabled on a production-labelled demo resource; exposure duration and actual access are unknown.',
    evidenceStatus: 'partial',
    uncertainty:
      'The sample does not include policy history, access logs, or approved change records.',
    deadlineAt: at('10:30'),
    timeline: [
      {
        at: at('06:42'),
        title: 'Storage policy changed',
        detail:
          'demo-cloud records publicAccess=enabled for demo-storage-prod.',
      },
      {
        at: at('07:02'),
        title: 'Incident triaged',
        detail: 'Awaiting change authorization and access-log review.',
      },
    ],
    missingEvidence: [
      'Change ticket or deployment record',
      'Storage access logs during exposure window',
    ],
    suggestedSteps: [
      'Verify the current policy through the cloud control plane.',
      'Confirm whether the change was authorized.',
      'Review access logs for the exposure window.',
    ],
  },
  {
    id: id.incident3,
    title: 'Quarantined endpoint payload',
    description:
      'Endpoint protection reports a payload quarantined on a synthetic laptop.',
    alertIds: [id.alert4],
    status: 'new',
    severity: 'critical',
    riskScore: 87,
    confidence: 0.92,
    needsHumanReview: false,
    createdAt: at('05:36'),
    updatedAt: at('05:36'),
    riskRationale:
      'A high-severity endpoint detection was quarantined. Scope and initial execution vector are not represented in the sample.',
    evidenceStatus: 'reviewed',
    uncertainty:
      'Quarantine is reported by the synthetic source and has not been independently verified.',
    deadlineAt: at('08:50'),
    timeline: [
      {
        at: at('05:31'),
        title: 'Payload detected',
        detail: 'demo-edr reports quarantine on demo-laptop-12.',
      },
      {
        at: at('05:32'),
        title: 'Automated action recorded',
        detail: 'Source payload lists action=quarantined.',
      },
    ],
    missingEvidence: [
      'Quarantine artifact and file metadata',
      'Related process and user context',
    ],
    suggestedSteps: [
      'Confirm quarantine state on the endpoint.',
      'Collect the detection details and file metadata.',
      'Check for similar detections on other demo assets.',
    ],
  },
  {
    id: id.incident4,
    title: 'Suspicious attachment reported by finance user',
    description:
      'A synthetic user report flags a macro-enabled document. No execution is recorded.',
    alertIds: [id.alert5],
    status: 'triaged',
    severity: 'medium',
    riskScore: 44,
    confidence: 0.61,
    needsHumanReview: false,
    createdAt: at('04:24'),
    updatedAt: at('04:50'),
    riskRationale:
      'The message was reported, but attachment detonation and recipient scope are absent.',
    evidenceStatus: 'partial',
    uncertainty:
      'No evidence indicates whether the attachment was opened or executed.',
    deadlineAt: at('12:00'),
    timeline: [
      {
        at: at('04:18'),
        title: 'Message reported',
        detail: 'demo-mail sample lists a suspicious attachment.',
      },
      {
        at: at('04:50'),
        title: 'Initial triage',
        detail: 'No execution evidence included.',
      },
    ],
    missingEvidence: [
      'Message headers and attachment hash',
      'Recipient and click telemetry',
    ],
    suggestedSteps: [
      'Collect the original message and attachment hash.',
      'Check click and endpoint telemetry.',
      'Search for other recipients in the demo records.',
    ],
  },
  {
    id: id.incident5,
    title: 'Privileged account factor enrollment review',
    description:
      'A synthetic identity event records a new factor enrollment for a privileged demo account.',
    alertIds: [id.alert6],
    status: 'resolved',
    severity: 'medium',
    riskScore: 29,
    confidence: 0.88,
    needsHumanReview: false,
    createdAt: at('03:58'),
    updatedAt: at('04:40'),
    riskRationale:
      'The account owner confirmed the demo enrollment during the simulated review.',
    evidenceStatus: 'reviewed',
    uncertainty: 'The confirmation is part of this demonstration dataset only.',
    deadlineAt: at('11:00'),
    timeline: [
      {
        at: at('03:52'),
        title: 'Factor enrolled',
        detail: 'Synthetic identity event lists a security key.',
      },
      {
        at: at('04:40'),
        title: 'Marked resolved',
        detail: 'Synthetic exercise records owner confirmation.',
      },
    ],
    missingEvidence: [],
    suggestedSteps: ['Retain the confirmation in the exercise notes.'],
  },
];

export const demoDashboardData: DashboardDataset = {
  source: 'synthetic-demo',
  incidents,
  alerts,
  analysts: [
    {
      id: id.analyst1,
      displayName: 'Aarav Mehta',
      skills: ['Identity', 'Endpoint'],
      availability: 'available',
      capacity: 5,
      workload: 3,
    },
    {
      id: id.analyst2,
      displayName: 'Nisha Rao',
      skills: ['Cloud', 'IAM'],
      availability: 'available',
      capacity: 4,
      workload: 2,
    },
    {
      id: id.analyst3,
      displayName: 'Kabir Sen',
      skills: ['Endpoint', 'Malware'],
      availability: 'available',
      capacity: 4,
      workload: 4,
    },
    {
      id: id.analyst4,
      displayName: 'Mira Das',
      skills: ['Network', 'Email'],
      availability: 'unavailable',
      capacity: 3,
      workload: 2,
    },
  ],
  assignments: [
    {
      id: 'demo-assignment-01',
      incidentId: id.incident1,
      analystId: id.analyst1,
      status: 'active',
      assignedAt: at('08:43'),
      explanation:
        'Demonstration assignment based on identity and endpoint skills.',
    },
    {
      id: 'demo-assignment-02',
      incidentId: id.incident2,
      analystId: id.analyst2,
      status: 'active',
      assignedAt: at('07:03'),
      explanation: 'Demonstration assignment based on cloud and IAM skills.',
    },
  ],
  volume: [
    { date: 'Oct 23', alerts: 17, incidents: 3 },
    { date: 'Oct 24', alerts: 23, incidents: 4 },
    { date: 'Oct 25', alerts: 14, incidents: 2 },
    { date: 'Oct 26', alerts: 31, incidents: 5 },
    { date: 'Oct 27', alerts: 26, incidents: 4 },
    { date: 'Oct 28', alerts: 38, incidents: 6 },
    { date: 'Oct 29', alerts: 21, incidents: 5 },
  ],
};

export const severityOrder: AlertSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'informational',
  'unknown',
];

export function getSeverityCounts(data: DashboardDataset) {
  return severityOrder.map((severity) => ({
    severity,
    count: data.incidents.filter((incident) => incident.severity === severity)
      .length,
  }));
}

export function getDashboardMetrics(data: DashboardDataset, now = Date.now()) {
  const open = data.incidents.filter(
    (incident) => !['resolved', 'closed'].includes(incident.status),
  );
  const deadlineIncidents = open.filter(
    (incident) => Date.parse(incident.deadlineAt) <= now + 60 * 60 * 1000,
  );
  return {
    openIncidents: open.length,
    criticalIncidents: open.filter(
      (incident) => incident.severity === 'critical',
    ).length,
    totalAlerts: data.alerts.length,
    deadlineRisk: deadlineIncidents.length,
    overdue: deadlineIncidents.filter(
      (incident) => Date.parse(incident.deadlineAt) < now,
    ).length,
  };
}

export function filterIncidents(
  incidents: DemoIncident[],
  filters: { query: string; severity: string; status: string },
): DemoIncident[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return incidents.filter((incident) => {
    const matchesQuery =
      !query ||
      [incident.title, incident.id, incident.description].some((value) =>
        value.toLocaleLowerCase().includes(query),
      );
    return (
      matchesQuery &&
      (filters.severity === 'all' || incident.severity === filters.severity) &&
      (filters.status === 'all' || incident.status === filters.status)
    );
  });
}

export function getAlertSeverityCounts(data: DashboardDataset) {
  return severityOrder.map((severity) => ({
    severity,
    count: data.alerts.filter((alert) => alert.severity === severity).length,
  }));
}
