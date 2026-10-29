import {
  AlertSeveritySchema,
  AnalysisEvidenceValidationStatusSchema,
  ApiErrorResponseSchema,
  ApiSessionResponseSchema,
  AssignmentSchema,
  DependencyHealthResponseSchema,
  HealthResponseSchema,
  IncidentAnalysisMethodSchema,
  IncidentAuditHistoryResponseSchema,
  IncidentBreachRiskResponseSchema,
  IncidentPriorityResponseSchema,
  IncidentSchema,
  IncidentSlaResponseSchema,
  SecurityAlertSchema,
  type ApiSessionResponse,
  type Assignment,
  type DependencyHealthResponse,
  type HealthResponse,
  type Incident,
  type IncidentAuditHistoryResponse,
  type IncidentBreachRiskResponse,
  type IncidentPriorityResponse,
  type IncidentSlaResponse,
  type SecurityAlert,
} from '@cybernexus/shared';
import { z } from 'zod';

const RecordSchema = z.record(z.string(), z.unknown());
const PageSchema = z.object({
  items: z.array(z.unknown()).max(100),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
  totalItems: z.number().int().min(0),
});
const AssignmentWithLabelsSchema = z.object({
  assignment: AssignmentSchema,
  analyst: z.object({ id: z.string(), displayName: z.string() }).optional(),
  incident: z
    .object({
      id: z.string(),
      title: z.string(),
      severity: AlertSeveritySchema,
    })
    .optional(),
});
const CurrentAssignmentsSchema = z.object({
  assignments: z.array(z.unknown()).max(1000),
});
const AnalysisSchema = z.object({
  id: z.string(),
  analysisMethod: IncidentAnalysisMethodSchema,
  summary: z.string(),
  proposedSeverity: AlertSeveritySchema,
  analysisConfidence: z.number().min(0).max(1),
  validationStatus: AnalysisEvidenceValidationStatusSchema,
  semanticVerification: z.literal('not_performed'),
  needsHumanReview: z.boolean(),
  findings: z.array(RecordSchema),
  missingInformation: z.array(z.string()),
  recommendedNextSteps: z.array(z.string()),
});

export type DashboardAssignment = {
  assignment: Assignment;
  analyst?: { id: string; displayName: string };
  incident?: { id: string; title: string; severity: string };
};

export type ConnectedDashboardData = {
  session: ApiSessionResponse;
  incidents: Incident[];
  alerts: SecurityAlert[] | null;
  assignments: DashboardAssignment[] | null;
  unavailable: string[];
};

export type IncidentWorkspaceData = {
  detail: Record<string, unknown> | null;
  linkedAlerts: SecurityAlert[] | null;
  timeline: Record<string, unknown>[] | null;
  graph: {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  } | null;
  analysis: z.infer<typeof AnalysisSchema> | null;
  priority: IncidentPriorityResponse | null;
  sla: IncidentSlaResponse | null;
  breachRisk: IncidentBreachRiskResponse | null;
  audit: IncidentAuditHistoryResponse | null;
  unavailable: string[];
};

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DashboardApiError';
  }
}

async function requestJson<T>(
  path: string,
  token: string | undefined,
  schema: z.ZodType<T>,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    response = await fetcher(path, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new DashboardApiError('The API could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const apiError = ApiErrorResponseSchema.safeParse(body);
    const gatewayError = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(body);
    throw new DashboardApiError(
      apiError.success
        ? apiError.data.error.message
        : gatewayError.success
          ? gatewayError.data.error.message
          : `API request failed (${response.status}).`,
      response.status,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new DashboardApiError(
      'The API response did not match its contract.',
      response.status,
    );
  return parsed.data;
}

async function loadPages<T>(
  path: string,
  token: string,
  parseItem: (value: unknown) => T,
  fetcher: typeof fetch,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const result = await requestJson(
      `${path}${separator}page=${page}&pageSize=100`,
      token,
      PageSchema,
      fetcher,
    );
    for (const item of result.items) {
      try {
        items.push(parseItem(item));
      } catch {
        throw new DashboardApiError(
          'A record did not match its shared contract.',
        );
      }
    }
    if (!result.hasNext) return items;
  }
  throw new DashboardApiError(
    'The API result exceeds the dashboard page limit.',
  );
}

function parseIncident(value: unknown): Incident {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DashboardApiError('An incident record was malformed.');
  const record = value as Record<string, unknown>;
  return IncidentSchema.parse({
    id: record.id,
    title: record.title,
    alertIds: record.alertIds,
    status: record.status,
    severity: record.severity,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(typeof record.needsHumanReview === 'boolean'
      ? { needsHumanReview: record.needsHumanReview }
      : {}),
  });
}

function parseAlert(value: unknown): SecurityAlert {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DashboardApiError('An alert record was malformed.');
  const record = value as Record<string, unknown>;
  return SecurityAlertSchema.parse({
    id: record.id,
    source: record.source,
    ...(typeof record.externalId === 'string'
      ? { externalId: record.externalId }
      : {}),
    observedAt: record.observedAt,
    title: record.title,
    severity: record.severity,
    payload: record.payload,
    ingestedAt: record.ingestedAt,
  });
}

export async function getApiHealth(
  fetcher: typeof fetch = fetch,
  timeoutMs = 3500,
): Promise<HealthResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('/api/health', {
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const apiError = ApiErrorResponseSchema.safeParse(body);
      throw new Error(
        apiError.success ? apiError.data.error.message : 'API request failed.',
      );
    }
    return HealthResponseSchema.parse(body);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDependencyHealth(
  fetcher: typeof fetch = fetch,
  timeoutMs = 4_000,
): Promise<DependencyHealthResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('/api/health/dependencies', {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Dependency health is unavailable.');
    return DependencyHealthResponseSchema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function connectDashboard(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<ConnectedDashboardData> {
  if (!token.trim())
    throw new DashboardApiError('Enter an API token to connect.');
  const session = await requestJson(
    '/api/v1/session',
    token.trim(),
    ApiSessionResponseSchema,
    fetcher,
  );
  if (!session.scopes.includes('api:read'))
    throw new DashboardApiError(
      'This token does not have api:read permission.',
      403,
    );

  const unavailable: string[] = [];
  const [incidentsResult, alertsResult, assignmentsResult] =
    await Promise.allSettled([
      loadPages('/api/v1/incidents', token.trim(), parseIncident, fetcher),
      loadPages('/api/v1/alerts', token.trim(), parseAlert, fetcher),
      requestJson(
        '/api/v1/assignments/current',
        token.trim(),
        CurrentAssignmentsSchema,
        fetcher,
      ),
    ]);
  if (incidentsResult.status === 'rejected') throw incidentsResult.reason;
  let alerts: SecurityAlert[] | null = null;
  if (alertsResult.status === 'fulfilled') alerts = alertsResult.value;
  else unavailable.push('Alerts');
  let assignments: DashboardAssignment[] | null = null;
  if (assignmentsResult.status === 'fulfilled') {
    let malformedAssignment = false;
    assignments = assignmentsResult.value.assignments.flatMap((raw) => {
      const record =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      const parsed = AssignmentWithLabelsSchema.safeParse({
        assignment: {
          id: record.id,
          incidentId: record.incidentId,
          analystId: record.analystId,
          status: record.status,
          assignedAt: record.assignedAt,
          explanation: record.explanation,
        },
        ...(record.analyst ? { analyst: record.analyst } : {}),
        ...(record.incident ? { incident: record.incident } : {}),
      });
      if (!parsed.success) malformedAssignment = true;
      return parsed.success ? [parsed.data] : [];
    });
    if (malformedAssignment) {
      assignments = null;
      unavailable.push('Current assignments (invalid API record)');
    }
  } else unavailable.push('Current assignments');

  return {
    session,
    incidents: incidentsResult.value,
    alerts,
    assignments,
    unavailable,
  };
}

async function optionalResource<T>(
  name: string,
  path: string,
  token: string,
  schema: z.ZodType<T>,
  fetcher: typeof fetch,
  unavailable: string[],
  notFoundMeansEmpty = false,
): Promise<T | null> {
  try {
    return await requestJson(path, token, schema, fetcher);
  } catch (error) {
    if (
      error instanceof DashboardApiError &&
      error.status === 404 &&
      notFoundMeansEmpty
    )
      return null;
    unavailable.push(name);
    return null;
  }
}

const ObjectResponseSchema = z.object({}).passthrough();
const TimelineSchema = z.object({ items: z.array(RecordSchema).max(2000) });
const GraphSchema = z.object({
  nodes: z.array(RecordSchema).max(1000),
  edges: z.array(RecordSchema).max(2000),
});
const DetailSchema = z.object({
  incident: RecordSchema,
  alerts: z.array(z.unknown()),
  relationships: z.array(z.unknown()),
});
const AnalysisResponseSchema = z.object({ analysis: AnalysisSchema });
const PriorityResponseSchema = z.object({
  priority: IncidentPriorityResponseSchema,
});
const SlaResponseSchema = z.object({ sla: IncidentSlaResponseSchema });
const BreachResponseSchema = z.object({
  breachRisk: IncidentBreachRiskResponseSchema,
});
const AuditResponseSchema = IncidentAuditHistoryResponseSchema;

export async function getIncidentWorkspace(
  token: string,
  incidentId: string,
  fetcher: typeof fetch = fetch,
): Promise<IncidentWorkspaceData> {
  const root = `/api/v1/incidents/${encodeURIComponent(incidentId)}`;
  const unavailable: string[] = [];
  const requests = await Promise.all([
    optionalResource(
      'Incident detail',
      root,
      token,
      DetailSchema,
      fetcher,
      unavailable,
    ),
    optionalResource(
      'Timeline',
      `${root}/timeline`,
      token,
      TimelineSchema,
      fetcher,
      unavailable,
    ),
    optionalResource(
      'Entity graph',
      `${root}/graph`,
      token,
      GraphSchema,
      fetcher,
      unavailable,
    ),
    optionalResource(
      'Analysis',
      `${root}/analysis`,
      token,
      AnalysisResponseSchema,
      fetcher,
      unavailable,
      true,
    ),
    optionalResource(
      'Prioritization',
      `${root}/priority`,
      token,
      PriorityResponseSchema,
      fetcher,
      unavailable,
      true,
    ),
    optionalResource(
      'SLA',
      `${root}/sla`,
      token,
      SlaResponseSchema,
      fetcher,
      unavailable,
    ),
    optionalResource(
      'SLA breach risk',
      `${root}/breach-risk`,
      token,
      BreachResponseSchema,
      fetcher,
      unavailable,
    ),
    optionalResource(
      'Audit history',
      `${root}/audit?page=1&pageSize=100`,
      token,
      AuditResponseSchema,
      fetcher,
      unavailable,
    ),
  ]);
  const [
    detail,
    timeline,
    graph,
    analysisResult,
    priorityResult,
    slaResult,
    breachResult,
    audit,
  ] = requests;
  let linkedAlerts: SecurityAlert[] | null = null;
  if (detail) {
    try {
      linkedAlerts = detail.alerts.map(parseAlert);
    } catch {
      unavailable.push('Linked alerts (invalid API record)');
    }
  }
  return {
    detail,
    linkedAlerts,
    timeline: timeline?.items ?? null,
    graph,
    analysis: analysisResult?.analysis ?? null,
    priority: priorityResult?.priority ?? null,
    sla: slaResult?.sla ?? null,
    breachRisk: breachResult?.breachRisk ?? null,
    audit,
    unavailable,
  };
}

export async function runAssignmentWhatIf(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetcher('/api/v1/assignments/simulate', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
  } catch {
    throw new DashboardApiError('What-if simulation could not reach the API.');
  } finally {
    clearTimeout(timeout);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new DashboardApiError(
      'What-if simulation was unavailable.',
      response.status,
    );
  const parsed = ObjectResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.assignmentsPersisted !== false)
    throw new DashboardApiError('Simulation response failed its safety check.');
  return parsed.data;
}
