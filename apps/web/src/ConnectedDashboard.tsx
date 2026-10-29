import { useEffect, useState } from 'react';
import {
  getIncidentWorkspace,
  runAssignmentWhatIf,
  type ConnectedDashboardData,
  type IncidentWorkspaceData,
} from './api.js';
import type {
  HealthIndicatorState,
  HealthIndicators,
} from './use-dependency-health.js';

type Page =
  | 'overview'
  | 'incidents'
  | 'alerts'
  | 'investigation'
  | 'assignment'
  | 'audit'
  | 'evaluation';
type Props = {
  token: string;
  data: ConnectedDashboardData;
  expressHealthy: boolean;
  dependencyHealth: HealthIndicators;
  onDisconnect: () => void;
};

const pages: { id: Page; label: string }[] = [
  { id: 'overview', label: 'SOC Overview' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'assignment', label: 'Assignments' },
  { id: 'audit', label: 'Audit' },
  { id: 'evaluation', label: 'Evaluation' },
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = 'Unavailable'): string {
  return typeof value === 'string' && value.length ? value : fallback;
}

function healthLabel(value: HealthIndicatorState): string {
  return value.replaceAll('_', ' ');
}

function items(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#101723]/90">
      <h2 className="border-b border-white/[0.06] px-5 py-4 text-sm font-semibold text-slate-100">
        {title}
      </h2>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Status({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xs font-medium text-slate-200">{value}</div>
      <div className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</div>
    </div>
  );
}

export default function ConnectedDashboard({
  token,
  data,
  expressHealthy,
  dependencyHealth,
  onDisconnect,
}: Props) {
  const [page, setPage] = useState<Page>('overview');
  const [selectedId, setSelectedId] = useState(data.incidents[0]?.id ?? '');
  const [workspace, setWorkspace] = useState<IncidentWorkspaceData>();
  const [detailState, setDetailState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >(data.incidents.length ? 'loading' : 'idle');
  const [detailError, setDetailError] = useState('');
  const [whatIf, setWhatIf] = useState<Record<string, unknown>>();
  const [whatIfState, setWhatIfState] = useState<'idle' | 'loading' | 'error'>(
    'idle',
  );
  const [whatIfError, setWhatIfError] = useState('');

  useEffect(() => {
    if (!selectedId) {
      setWorkspace(undefined);
      setDetailState('idle');
      return;
    }
    let active = true;
    setDetailState('loading');
    setDetailError('');
    void getIncidentWorkspace(token, selectedId)
      .then((result) => {
        if (active) {
          setWorkspace(result);
          setDetailState('ready');
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDetailError(
          error instanceof Error
            ? error.message
            : 'Incident detail unavailable.',
        );
        setDetailState('error');
      });
    return () => {
      active = false;
    };
  }, [token, selectedId]);

  const selected = data.incidents.find(
    (incident) => incident.id === selectedId,
  );
  const linkedAlerts =
    workspace?.linkedAlerts ??
    data.alerts?.filter((alert) => selected?.alertIds.includes(alert.id)) ??
    null;
  const liveAssignments = data.assignments ?? [];
  const openIncidents = data.incidents.filter(
    (incident) => !['resolved', 'closed'].includes(incident.status),
  );
  const criticalIncidents = openIncidents.filter(
    (incident) => incident.severity === 'critical',
  );

  const runWhatIf = async () => {
    setWhatIfState('loading');
    setWhatIfError('');
    setWhatIf(undefined);
    try {
      setWhatIf(await runAssignmentWhatIf(token));
      setWhatIfState('idle');
    } catch (error) {
      setWhatIfError(
        error instanceof Error ? error.message : 'Simulation unavailable.',
      );
      setWhatIfState('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#090e16] px-4 py-5 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
          <div>
            <div className="text-[11px] font-bold tracking-[0.18em] text-emerald-300">
              CYBERNEXUS · CONNECTED WORKSPACE
            </div>
            <h1 className="mt-2 text-2xl font-semibold">SOC Command Centre</h1>
            <p className="mt-1 text-xs text-slate-500">
              Express-backed records · signed in as {data.session.subject}
            </p>
          </div>
          <button
            onClick={onDisconnect}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
          >
            Disconnect
          </button>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Status
            label="Express API"
            value={healthLabel(dependencyHealth.api)}
            detail={
              expressHealthy
                ? 'Express dependency-health endpoint responded.'
                : 'Express health endpoint is unavailable.'
            }
          />
          <Status
            label="PostgreSQL"
            value={healthLabel(dependencyHealth.database)}
            detail="Read-only database connectivity check."
          />
          <Status
            label="FastAPI service"
            value={healthLabel(dependencyHealth.aiService)}
            detail="Authenticated private readiness check."
          />
          <Status
            label="Gemini configuration"
            value={healthLabel(dependencyHealth.geminiProvider)}
            detail="Configuration status only; credentials are never returned."
          />
          <Status
            label="Gemini connectivity"
            value={healthLabel(dependencyHealth.geminiConnectivity)}
            detail="No Gemini connectivity request is made by health checks."
          />
        </div>

        <nav
          className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.07] bg-[#101723]/80 p-1"
          aria-label="Connected dashboard navigation"
        >
          {pages.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs ${page === item.id ? 'bg-emerald-400/10 text-emerald-200' : 'text-slate-400 hover:bg-white/5'}`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {data.unavailable.length > 0 && (
          <div
            role="status"
            className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-xs text-amber-100"
          >
            Some API data is unavailable: {data.unavailable.join(', ')}. No demo
            records are mixed into this connected view.
          </div>
        )}
        {detailState === 'loading' && page !== 'investigation' && (
          <p role="status" className="text-xs text-slate-500">
            Loading selected incident details…
          </p>
        )}

        {page === 'overview' && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Open incidents" value={openIncidents.length} />
              <Metric
                label="Critical incidents"
                value={criticalIncidents.length}
              />
              <Metric
                label="Alerts returned"
                value={data.alerts?.length ?? 'Unavailable'}
              />
            </div>
            <IncidentList
              incidents={data.incidents}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setPage('investigation');
              }}
            />
          </>
        )}

        {page === 'incidents' && (
          <IncidentList
            incidents={data.incidents}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setPage('investigation');
            }}
          />
        )}

        {page === 'alerts' && (
          <Panel title="API alerts">
            <p className="mb-3 text-xs text-slate-500">
              Records from GET /api/v1/alerts. Raw payloads are not rendered.
            </p>
            {data.alerts === null ? (
              <Empty>
                Alert endpoint unavailable for this token or service.
              </Empty>
            ) : data.alerts.length ? (
              <div className="divide-y divide-white/[0.05]">
                {data.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex flex-wrap justify-between gap-2 py-3 text-xs"
                  >
                    <span className="text-slate-200">{alert.title}</span>
                    <span className="text-slate-500">
                      {alert.source} · {alert.severity} ·{' '}
                      {new Date(alert.observedAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No alerts returned by the API.</Empty>
            )}
          </Panel>
        )}

        {page === 'investigation' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {selected?.title ??
                  (selectedId ? 'Incident unavailable' : 'Select an incident')}
              </h2>
              {selected && (
                <span className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-slate-300">
                  {selected.severity} · {selected.status}
                </span>
              )}
            </div>
            {!selectedId ? (
              <Empty>No incidents are available.</Empty>
            ) : detailState === 'loading' ? (
              <p role="status" className="py-8 text-sm text-slate-400">
                Loading incident details…
              </p>
            ) : detailState === 'error' ? (
              <p
                role="alert"
                className="rounded-xl border border-rose-300/20 p-4 text-sm text-rose-200"
              >
                {detailError}
              </p>
            ) : (
              workspace && (
                <IncidentWorkspace
                  workspace={workspace}
                  linkedAlerts={linkedAlerts}
                />
              )
            )}
          </>
        )}

        {page === 'assignment' && (
          <div className="space-y-4">
            <Panel title="Current applied assignments">
              <p className="mb-3 text-xs text-slate-500">
                Read-only records from GET /api/v1/assignments/current.
              </p>
              {data.assignments === null ? (
                <Empty>Current assignments unavailable.</Empty>
              ) : liveAssignments.length ? (
                <div className="divide-y divide-white/[0.05]">
                  {liveAssignments.map(({ assignment, analyst, incident }) => (
                    <div
                      key={assignment.id}
                      className="flex flex-wrap justify-between gap-3 py-3 text-xs"
                    >
                      <span>{incident?.title ?? assignment.incidentId}</span>
                      <span className="text-slate-400">
                        {analyst?.displayName ?? assignment.analystId} ·{' '}
                        {assignment.status} · {assignment.explanation}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>No active assignment records.</Empty>
              )}
            </Panel>
            <Panel title="What-if simulation">
              <p className="mb-3 text-xs leading-5 text-slate-400">
                Runs the existing deterministic baseline simulation. Its
                proposal is separate from applied assignments and this action
                does not apply it.
              </p>
              <button
                disabled={whatIfState === 'loading'}
                onClick={() => void runWhatIf()}
                className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100 disabled:opacity-50"
              >
                {whatIfState === 'loading'
                  ? 'Simulating…'
                  : 'Run what-if simulation'}
              </button>
              {whatIfError && (
                <p role="alert" className="mt-3 text-xs text-rose-200">
                  {whatIfError}
                </p>
              )}
              {whatIf && (
                <div
                  role="status"
                  className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4 text-xs"
                >
                  <strong className="text-emerald-100">
                    Simulation completed · assignmentsPersisted: false
                  </strong>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-[10px] text-slate-300">
                    {JSON.stringify(whatIf, null, 2)}
                  </pre>
                </div>
              )}
            </Panel>
          </div>
        )}

        {page === 'audit' && (
          <IncidentAudit
            workspace={workspace}
            loading={detailState === 'loading'}
            selectedTitle={selected?.title}
          />
        )}

        {page === 'evaluation' && (
          <Panel title="Evaluation results">
            <p className="text-sm text-slate-300">
              No evaluation metrics endpoint is available in the current API
              contract.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              This connected view does not calculate ground-truth precision,
              recall, accuracy, or operational performance from incident counts.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#101723]/90 p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-[10px] text-slate-600">
        From the connected API response
      </div>
    </div>
  );
}

function IncidentList({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: ConnectedDashboardData['incidents'];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel title="Incidents">
      <p className="mb-3 text-xs text-slate-500">
        GET /api/v1/incidents · {incidents.length} returned records
      </p>
      {incidents.length ? (
        <div className="divide-y divide-white/[0.05]">
          {incidents.map((incident) => (
            <button
              key={incident.id}
              onClick={() => onSelect(incident.id)}
              aria-current={incident.id === selectedId ? 'true' : undefined}
              className="flex w-full flex-wrap justify-between gap-2 py-3 text-left text-xs hover:bg-white/[0.025]"
            >
              <span className="text-slate-100">
                {incident.title}
                <span className="ml-2 font-mono text-[10px] text-slate-600">
                  {incident.id}
                </span>
              </span>
              <span className="text-slate-400">
                {incident.severity} · {incident.status} ·{' '}
                {incident.alertIds.length} alerts
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty>No incidents returned by the API.</Empty>
      )}
    </Panel>
  );
}

function IncidentWorkspace({
  workspace,
  linkedAlerts,
}: {
  workspace: IncidentWorkspaceData;
  linkedAlerts: ConnectedDashboardData['alerts'];
}) {
  const detail = record(workspace.detail);
  const timeline = items(workspace.timeline);
  const graph = workspace.graph;
  const auditItems = workspace.audit?.items ?? [];
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Prioritization and SLA">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase text-slate-500">
              Risk score
            </div>
            <p className="mt-1 text-lg">
              {workspace.priority?.riskScore ?? 'No persisted score'}
            </p>
            <p className="text-xs text-slate-500">
              {workspace.priority?.effectivePriority ?? 'Priority unavailable'}
            </p>
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500">
              SLA state
            </div>
            <p className="mt-1 text-lg">
              {workspace.sla?.state ?? 'Unavailable'}
            </p>
            <p className="text-xs text-slate-500">
              {workspace.sla?.deadlineAt ?? 'No deadline reported'}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Breach band: {workspace.breachRisk?.band ?? 'Unavailable'} ·
          Predictive model: {workspace.breachRisk ? 'not used' : 'not reported'}
        </p>
        {workspace.priority && (
          <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
            {workspace.priority.factors.map((factor, index) => (
              <p
                key={`${factor.factor}-${index}`}
                className="text-[10px] text-slate-500"
              >
                {factor.factor}: {factor.points ?? 'unscored'} ·{' '}
                {factor.explanation}
              </p>
            ))}
          </div>
        )}
        {workspace.sla && (
          <p className="mt-2 text-[10px] text-slate-500">
            {workspace.sla.explanation} ·{' '}
            {workspace.sla.remainingMinutes ?? 'unknown'} minutes remaining
          </p>
        )}
      </Panel>
      <Panel title="Stored analysis">
        <p className="mb-2 text-[10px] text-slate-500">
          AI/model analysis is advisory. Semantic evidence support is not
          verified.
        </p>
        {workspace.analysis ? (
          <>
            <p className="text-sm text-slate-200">
              {workspace.analysis.summary}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Method: {workspace.analysis.analysisMethod} · Reference status:{' '}
              {workspace.analysis.validationStatus} · Human review:{' '}
              {workspace.analysis.needsHumanReview
                ? 'required'
                : 'not indicated'}
            </p>
            {workspace.analysis.findings.length > 0 && (
              <div className="mt-3 space-y-2">
                {workspace.analysis.findings.map((finding, index) => (
                  <div
                    key={`${String(finding.conclusion)}-${index}`}
                    className="rounded-lg bg-white/[0.025] p-3"
                  >
                    <p className="text-xs text-slate-200">
                      {str(finding.conclusion)}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {str(
                        finding.evidenceValidationStatus,
                        'Evidence validation unavailable',
                      )}{' '}
                      · verification{' '}
                      {str(finding.verificationStatus, 'unknown')}
                    </p>
                    <p className="mt-1 text-[10px] text-amber-200/80">
                      {str(finding.uncertainty, 'Uncertainty not reported')}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {workspace.analysis.missingInformation.length > 0 && (
              <p className="mt-3 text-[10px] text-amber-200">
                Missing information:{' '}
                {workspace.analysis.missingInformation.join(' · ')}
              </p>
            )}
            {workspace.analysis.recommendedNextSteps.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-[10px] text-slate-400">
                {workspace.analysis.recommendedNextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Empty>No completed analysis record was returned.</Empty>
        )}
      </Panel>
      <Panel title="Incident timeline">
        {timeline.length ? (
          <div className="space-y-3">
            {timeline.map((event) => (
              <div
                key={str(event.id, JSON.stringify(event))}
                className="border-l border-emerald-300/20 pl-3"
              >
                <p className="text-xs text-slate-200">{str(event.title)}</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  {str(event.occurredAt)} · {str(event.kind)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No timeline events returned.</Empty>
        )}
      </Panel>
      <Panel title="Entity graph">
        {graph?.nodes.length ? (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </p>
            <div className="space-y-2">
              {graph.nodes.map((node) => (
                <div
                  key={str(node.id, JSON.stringify(node))}
                  className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs"
                >
                  <span className="text-emerald-200">{str(node.type)}</span>
                  <span className="ml-2 text-slate-200">{str(node.label)}</span>
                </div>
              ))}
            </div>
            {graph.edges.map((edge) => (
              <p
                key={str(edge.id, JSON.stringify(edge))}
                className="mt-2 text-[10px] text-slate-500"
              >
                {str(edge.sourceId)} → {str(edge.targetId)} · {str(edge.type)}
              </p>
            ))}
          </>
        ) : (
          <Empty>No graph records returned.</Empty>
        )}
      </Panel>
      <Panel title="Linked alerts">
        {linkedAlerts?.length ? (
          linkedAlerts.map((alert) => (
            <div
              key={alert.id}
              className="border-b border-white/[0.05] py-2 text-xs"
            >
              <p className="text-slate-200">{alert.title}</p>
              <p className="mt-1 text-slate-500">
                {alert.source} · {alert.severity} · {alert.observedAt}
              </p>
            </div>
          ))
        ) : (
          <Empty>
            {linkedAlerts === null
              ? 'Alert records unavailable.'
              : 'No linked alert records were returned.'}
          </Empty>
        )}
      </Panel>
      <IncidentAuditContent
        events={auditItems}
        unavailable={workspace.unavailable.includes('Audit history')}
      />
      {workspace.unavailable.length > 0 && (
        <div className="xl:col-span-2" role="status">
          <Empty>
            Unavailable detail endpoints: {workspace.unavailable.join(', ')}. A
            missing 404 resource is shown as empty.
          </Empty>
        </div>
      )}
      <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-slate-500">
        <summary className="cursor-pointer">Incident record fields</summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[10px]">
          {JSON.stringify(detail.incident ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function IncidentAudit({
  workspace,
  loading,
  selectedTitle,
}: {
  workspace?: IncidentWorkspaceData;
  loading: boolean;
  selectedTitle?: string;
}) {
  if (loading)
    return (
      <p role="status" className="py-8 text-sm text-slate-400">
        Loading audit history…
      </p>
    );
  if (!workspace)
    return (
      <Panel title="Audit history">
        <Empty>Select an incident to load its audit history.</Empty>
      </Panel>
    );
  return (
    <Panel title={`Audit history${selectedTitle ? ` · ${selectedTitle}` : ''}`}>
      <p className="mb-3 text-xs text-slate-500">
        Read-only events from the authorized incident audit endpoint.
      </p>
      <IncidentAuditContent
        events={workspace.audit?.items ?? []}
        unavailable={workspace.unavailable.includes('Audit history')}
      />
    </Panel>
  );
}

function IncidentAuditContent({
  events,
  unavailable,
}: {
  events: {
    id: string;
    eventType: string;
    actorId: string | null;
    occurredAt: string;
    metadata: Record<string, string | number | boolean | null>;
  }[];
  unavailable: boolean;
}) {
  if (unavailable)
    return (
      <Empty>
        Audit history unavailable. The token may lack audit:read permission.
      </Empty>
    );
  return events.length ? (
    <div className="divide-y divide-white/[0.05]">
      {events.map((event) => (
        <div
          key={event.id}
          className="flex flex-wrap justify-between gap-2 py-3 text-xs"
        >
          <span>{event.eventType}</span>
          <span className="text-slate-500">
            {event.actorId ?? 'System'} · {event.occurredAt}
          </span>
          <pre className="w-full overflow-auto text-[10px] text-slate-500">
            {JSON.stringify(event.metadata)}
          </pre>
        </div>
      ))}
    </div>
  ) : (
    <Empty>No audit records returned for this incident.</Empty>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-white/[0.05] bg-white/[0.015] px-4 py-6 text-xs text-slate-500">
      {children}
    </p>
  );
}
