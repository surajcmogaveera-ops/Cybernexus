import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  connectDashboard,
  getApiHealth,
  type ConnectedDashboardData,
} from './api.js';
import ConnectedDashboard from './ConnectedDashboard.js';
import {
  demoDashboardData,
  filterIncidents,
  getAlertSeverityCounts,
  getDashboardMetrics,
  getSeverityCounts,
  type DemoIncident,
} from './dashboard-data.js';
import { dashboardViewReducer, type DashboardPage } from './dashboard-state.js';

const navigation = [
  { id: 'overview', label: 'SOC Overview', icon: '⌂' },
  {
    id: 'incidents',
    label: 'Incidents',
    icon: '▤',
    count: demoDashboardData.incidents.filter(
      (item) => !['resolved', 'closed'].includes(item.status),
    ).length,
  },
  { id: 'alerts', label: 'Alert Explorer', icon: '⌁' },
  { id: 'investigation', label: 'Investigation', icon: '⌕' },
  { id: 'assignment', label: 'Analyst Assignment', icon: '♙' },
  { id: 'evaluation', label: 'Evaluation & Audit', icon: '◷' },
] as const;

type PageId = DashboardPage;
type HealthState = 'checking' | 'healthy' | 'unavailable' | 'unknown';

const severityClass: Record<string, string> = {
  critical: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
  high: 'border-orange-400/25 bg-orange-400/10 text-orange-300',
  medium: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
  low: 'border-sky-300/25 bg-sky-300/10 text-sky-200',
  informational: 'border-slate-400/25 bg-slate-400/10 text-slate-300',
  unknown: 'border-slate-500/25 bg-slate-500/10 text-slate-400',
};

const severityColor: Record<string, string> = {
  critical: '#fb7185',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#a5b4aa',
  informational: '#94a3b8',
  unknown: '#64748b',
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatDeadline(value: string, now = Date.now()) {
  const delta = Date.parse(value) - now;
  if (delta < 0) return `${Math.ceil(Math.abs(delta) / 60_000)}m overdue`;
  if (delta < 60 * 60_000)
    return `${Math.max(1, Math.ceil(delta / 60_000))}m left`;
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`severity-badge severity-${severity} inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${severityClass[severity] ?? severityClass.unknown}`}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: severityColor[severity] ?? severityColor.unknown }}
      />
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    investigating: 'bg-violet-400/10 text-violet-200',
    triaged: 'bg-cyan-400/10 text-cyan-200',
    new: 'bg-blue-400/10 text-blue-200',
    resolved: 'bg-emerald-400/10 text-emerald-200',
    closed: 'bg-slate-500/15 text-slate-400',
  };
  return (
    <span
      className={`rounded-md px-2 py-1 text-[11px] capitalize ${styles[status] ?? styles.new}`}
    >
      {status}
    </span>
  );
}

function HealthDot({ state }: { state: HealthState }) {
  return <span aria-hidden="true" className={`health-dot state-${state}`} />;
}

function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`soc-panel rounded-2xl border border-white/[0.07] bg-[#101723]/90 ${className}`}
    >
      {children}
    </section>
  );
}

function PanelHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="soc-panel-heading flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function IncidentTable({
  incidents,
  onSelect,
  selectedId,
  compact = false,
}: {
  incidents: DemoIncident[];
  onSelect: (id: string) => void;
  selectedId: string;
  compact?: boolean;
}) {
  if (!incidents.length)
    return (
      <div className="px-5 py-12 text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-xl bg-white/[0.04] text-lg text-slate-500">
          ⌕
        </div>
        <p className="mt-3 text-sm font-medium text-slate-300">
          No incidents match
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Try changing your search or filters.
        </p>
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead>
          <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <th className="px-5 py-3 font-medium">Incident</th>
            <th className="px-3 py-3 font-medium">Severity</th>
            {!compact && <th className="px-3 py-3 font-medium">Risk</th>}
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Alerts</th>
            <th className="px-3 py-3 font-medium">Owner</th>
            <th className="px-3 py-3 font-medium">Response SLA</th>
            <th className="px-5 py-3 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => {
            const analyst = demoDashboardData.analysts.find(
              (item) => item.id === incident.assignedAnalystId,
            );
            const remaining = Date.parse(incident.deadlineAt) - Date.now();
            return (
              <tr
                key={incident.id}
                aria-selected={selectedId === incident.id}
                className={`incident-row border-b border-white/[0.04] text-xs ${selectedId === incident.id ? 'is-selected' : ''}`}
              >
                <td className="max-w-[270px] px-5 py-3.5">
                  <button
                    type="button"
                    onClick={() => onSelect(incident.id)}
                    className="truncate text-left font-medium text-slate-200 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                    aria-label={`Open ${incident.title}`}
                  >
                    {incident.title}
                  </button>
                  <div className="mt-1 font-mono text-[10px] text-slate-500">
                    INC-{incident.id.slice(0, 6).toUpperCase()} ·{' '}
                    {formatTime(incident.createdAt)} UTC
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  <SeverityBadge severity={incident.severity} />
                </td>
                {!compact && (
                  <td className="px-3 py-3.5">
                    <span className="font-semibold tabular-nums text-slate-200">
                      {incident.riskScore}
                    </span>
                    <span className="ml-1 text-[10px] text-slate-500">
                      /100
                    </span>
                  </td>
                )}
                <td className="px-3 py-3.5">
                  <StatusBadge status={incident.status} />
                </td>
                <td className="px-3 py-3.5 text-slate-300">
                  {incident.alertIds.length}
                </td>
                <td className="px-3 py-3.5 text-slate-400">
                  {analyst?.displayName ?? (
                    <span className="text-slate-600">Unassigned</span>
                  )}
                </td>
                <td
                  className={`px-3 py-3.5 tabular-nums ${remaining < 0 ? 'text-rose-300' : remaining < 60 * 60_000 ? 'text-amber-200' : 'text-slate-400'}`}
                >
                  {formatDeadline(incident.deadlineAt)}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`inline-flex items-center gap-1.5 capitalize ${incident.evidenceStatus === 'reviewed' ? 'text-emerald-300' : incident.evidenceStatus === 'partial' ? 'text-amber-200' : 'text-slate-500'}`}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    {incident.evidenceStatus}
                    {incident.needsHumanReview && (
                      <span
                        title="Human review requested"
                        className="ml-1 text-amber-200"
                      >
                        · Review
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function useServiceHealth() {
  const [api, setApi] = useState<HealthState>('checking');
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        await getApiHealth(fetch, 3500);
        if (active) setApi('healthy');
      } catch {
        if (active) setApi('unavailable');
      }
    };
    void check();
    return () => {
      active = false;
    };
  }, []);
  return {
    api,
    database: 'unknown' as const,
    aiService: 'unknown' as const,
    geminiProvider: 'unknown' as const,
  };
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);

  return reducedMotion;
}

function usePageVisibilityMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const updateVisibility = () => {
      root.dataset.pageHidden = String(document.hidden);
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      delete root.dataset.pageHidden;
    };
  }, []);
}

function useCountUp(value: number) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let startTime = 0;
    let complete = false;

    const finish = () => {
      complete = true;
      if (frame) cancelAnimationFrame(frame);
      setDisplayValue(value);
    };

    if (preference.matches) {
      finish();
      return;
    }

    setDisplayValue(0);
    const duration = 1000;
    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else complete = true;
    };
    frame = requestAnimationFrame(tick);

    const handlePreferenceChange = (event: MediaQueryListEvent) => {
      if (event.matches) finish();
    };
    preference.addEventListener('change', handlePreferenceChange);

    return () => {
      if (!complete && frame) cancelAnimationFrame(frame);
      preference.removeEventListener('change', handlePreferenceChange);
    };
  }, [value]);

  return displayValue;
}

function DemoWorkspace() {
  usePageVisibilityMotion();
  const [view, dispatch] = useReducer(dashboardViewReducer, {
    page: 'overview',
    selectedIncidentId: demoDashboardData.incidents[0]!.id,
  });
  const { page, selectedIncidentId: selectedId } = view;
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const health = useServiceHealth();
  const selectedIncident =
    demoDashboardData.incidents.find((item) => item.id === selectedId) ??
    demoDashboardData.incidents[0]!;
  const metrics = getDashboardMetrics(demoDashboardData);
  const filteredIncidents = useMemo(
    () =>
      filterIncidents(demoDashboardData.incidents, { query, severity, status }),
    [query, severity, status],
  );

  const setPage = (pageId: PageId) =>
    dispatch({ type: 'navigate', page: pageId });
  const selectIncident = (incidentId: string) =>
    dispatch({ type: 'select-incident', incidentId });

  return (
    <div className="app-shell min-h-screen bg-[#090e16] text-slate-100">
      <div
        className="ambient-field pointer-events-none fixed inset-0"
        aria-hidden="true"
      >
        <span className="ambient-orb ambient-orb-emerald" />
        <span className="ambient-orb ambient-orb-sage" />
        <span className="ambient-orb ambient-orb-forest" />
        <span className="ambient-grid" />
        <span className="ambient-scan" />
      </div>
      <div className="app-frame relative mx-auto flex min-h-screen max-w-[1720px]">
        <aside className="soc-sidebar hidden w-[244px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0c121c]/90 px-4 py-5 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="brand-mark grid size-9 place-items-center rounded-xl bg-cyan-300 text-[#061117] shadow-[0_0_24px_rgba(70,211,219,0.2)]">
              <Logo />
            </div>
            <div>
              <div className="text-[13px] font-bold tracking-[0.16em] text-white">
                CYBERNEXUS
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                Security operations
              </div>
            </div>
          </div>
          <div className="mt-9 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-600">
            Workspace
          </div>
          <nav className="mt-2 space-y-1" aria-label="Primary navigation">
            {navigation.map((item) => (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                aria-current={page === item.id ? 'page' : undefined}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition ${page === item.id ? 'bg-cyan-300/[0.11] text-cyan-100 shadow-[inset_2px_0_0_#5ed6db]' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`}
              >
                <span
                  className={`nav-icon grid size-6 place-items-center text-xl ${page === item.id ? 'text-cyan-200' : 'text-slate-500 group-hover:text-slate-300'}`}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {'count' in item && (
                  <span
                    className={`incident-count rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-400 ${item.count > 0 ? 'has-count' : ''}`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-4">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-400">
                  SERVICE HEALTH
                </span>
                <span className="text-[9px] text-slate-600">LIVE CHECK</span>
              </div>
              <HealthRow name="Express API" state={health.api} />
              <HealthRow name="PostgreSQL" state={health.database} />
              <HealthRow name="AI service" state={health.aiService} />
              <HealthRow name="Gemini provider" state={health.geminiProvider} />
            </div>
            <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold text-amber-200">
                <span className="size-1.5 rounded-full bg-amber-300" /> DEMO
                DATA
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
                Synthetic records only. No live security telemetry is connected.
              </p>
            </div>
            <div className="px-2 text-[10px] text-slate-600">
              From alert overload to intelligent response.
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-10 pt-4 sm:px-6 lg:px-8 lg:pt-7 xl:px-10">
          <header className="soc-topbar mb-5 flex items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
            <div className="flex items-center gap-3 lg:hidden">
              <div className="brand-mark grid size-8 place-items-center rounded-lg bg-cyan-300 text-[#061117]">
                <Logo />
              </div>
              <span className="text-xs font-bold tracking-[0.15em]">
                CYBERNEXUS
              </span>
            </div>
            <div className="hidden text-[11px] text-slate-500 lg:block">
              <span className="text-slate-600">Workspace</span>
              <span className="mx-2">/</span>
              <span className="text-slate-300">
                {navigation.find((item) => item.id === page)?.label}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-4">
              <span className="hidden rounded-md border border-amber-300/15 bg-amber-300/[0.05] px-2.5 py-1.5 text-[10px] font-semibold tracking-wide text-amber-200 sm:inline-flex">
                DEMO DATA — SYNTHETIC
              </span>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-cyan-300"
                />{' '}
                Synthetic workspace
              </div>
              <div className="grid size-8 place-items-center rounded-full border border-white/10 bg-[#17212e] text-[10px] font-semibold text-slate-300">
                SOC
              </div>
            </div>
          </header>

          <nav
            className="soc-mobile-nav mb-5 flex gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-[#101723]/80 p-1 lg:hidden"
            aria-label="Mobile navigation"
          >
            {navigation.map((item) => (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                aria-current={page === item.id ? 'page' : undefined}
                className={`soc-nav-item shrink-0 rounded-lg px-3 py-2 text-[10px] ${page === item.id ? 'bg-cyan-300/10 text-cyan-100' : 'text-slate-400'}`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="soc-page-heading mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                <span className="eyebrow-dot size-1.5 rounded-full bg-cyan-300" />{' '}
                Surakshit Bharat · SOC workspace
              </div>
              <h1 className="page-title text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
                {pageTitle(page)}
              </h1>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500">
                {pageSubtitle(page)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setQuery('');
                  setSeverity('all');
                  setStatus('all');
                }}
                className="rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] text-slate-400 transition hover:border-white/20 hover:text-white"
              >
                Reset view
              </button>
              <div className="hidden rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] text-slate-400 sm:block">
                DEMO SNAPSHOT · 29 OCT 2026 UTC
              </div>
            </div>
          </div>

          <div key={page} className="soc-page-transition">
            {page === 'overview' && (
              <Overview
                incidents={demoDashboardData.incidents}
                selectedId={selectedId}
                metrics={metrics}
                onSelect={selectIncident}
                setPage={setPage}
                health={health}
              />
            )}
            {page === 'incidents' && (
              <IncidentQueue
                incidents={filteredIncidents}
                selectedId={selectedId}
                query={query}
                severity={severity}
                status={status}
                setQuery={setQuery}
                setSeverity={setSeverity}
                setStatus={setStatus}
                onSelect={selectIncident}
              />
            )}
            {page === 'investigation' && (
              <Investigation incident={selectedIncident} />
            )}
            {page === 'alerts' && (
              <AlertExplorer
                selectedId={selectedId}
                onIncident={selectIncident}
              />
            )}
            {page === 'assignment' && <AssignmentView />}
            {page === 'evaluation' && <EvaluationView />}
          </div>

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4 text-[10px] text-slate-600">
            <span>
              CyberNexus · From Alert Overload to Intelligent Response
            </span>
            <span>
              Synthetic demonstration workspace · No live incident actions
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [apiToken, setApiToken] = useState('');
  const [connected, setConnected] = useState<ConnectedDashboardData>();
  const [expressHealthy, setExpressHealthy] = useState(false);
  const [connectionState, setConnectionState] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const [connectionError, setConnectionError] = useState('');

  const connect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConnectionState('loading');
    setConnectionError('');
    try {
      let healthy = false;
      try {
        await getApiHealth();
        healthy = true;
      } catch {
        /* connection request below reports its own failure */
      }
      const data = await connectDashboard(apiToken);
      setExpressHealthy(healthy);
      setConnected(data);
      setConnectionState('idle');
    } catch (error) {
      setConnectionError(
        error instanceof Error
          ? error.message
          : 'Could not connect to the API.',
      );
      setConnectionState('error');
    }
  };

  if (connected)
    return (
      <ConnectedDashboard
        token={apiToken.trim()}
        data={connected}
        expressHealthy={expressHealthy}
        onDisconnect={() => {
          setConnected(undefined);
          setApiToken('');
          setConnectionState('idle');
        }}
      />
    );

  return (
    <>
      <section
        className="mx-auto mt-5 max-w-5xl rounded-2xl border border-emerald-300/15 bg-[#101723]/95 p-4 text-slate-100 sm:p-5"
        aria-label="Connect to CyberNexus API"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-emerald-100">
              Connect to live API data
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
              Enter a scoped bearer token with api:read. The token stays in page
              memory and is cleared when you disconnect or reload. Audit data
              requires audit:read; what-if simulation requires api:write.
              Nothing is sent to an AI provider.
            </p>
          </div>
          <span className="rounded-md bg-white/[0.04] px-2 py-1 text-[9px] uppercase tracking-wider text-slate-400">
            Express only
          </span>
        </div>
        <form
          onSubmit={(event) => void connect(event)}
          className="mt-4 flex flex-col gap-2 sm:flex-row"
        >
          <label className="sr-only" htmlFor="api-token">
            API bearer token
          </label>
          <input
            id="api-token"
            type="password"
            autoComplete="off"
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
            placeholder="Bearer token"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600"
          />
          <button
            type="submit"
            disabled={connectionState === 'loading' || !apiToken.trim()}
            className="rounded-lg bg-emerald-300 px-4 py-2 text-xs font-semibold text-[#07130d] disabled:opacity-50"
          >
            {connectionState === 'loading' ? 'Connecting…' : 'Connect'}
          </button>
        </form>
        {connectionState === 'error' && (
          <p role="alert" className="mt-3 text-xs text-rose-200">
            {connectionError}
          </p>
        )}
      </section>
      <DemoWorkspace />
    </>
  );
}

function pageTitle(page: PageId) {
  return navigation.find((item) => item.id === page)?.label ?? 'SOC Overview';
}
function pageSubtitle(page: PageId) {
  const values: Record<PageId, string> = {
    overview:
      'A clear operational picture of incidents, deadlines, evidence and response capacity.',
    incidents:
      'Search and triage the synthetic incident queue. Select a row to inspect its evidence.',
    alerts:
      'Source-level synthetic telemetry linked to the demonstration incident set.',
    investigation:
      'Review one selected incident, its evidence provenance, uncertainty and event sequence.',
    assignment:
      'Fictional analyst capacity and illustrative recommendations. No assignments are changed.',
    evaluation:
      'Demonstration coverage and audit examples. No measured model or operational metrics are claimed.',
  };
  return values[page];
}

function Overview({
  incidents,
  selectedId,
  metrics,
  onSelect,
  setPage,
  health,
}: {
  incidents: DemoIncident[];
  selectedId: string;
  metrics: ReturnType<typeof getDashboardMetrics>;
  onSelect: (id: string) => void;
  setPage: (page: PageId) => void;
  health: ReturnType<typeof useServiceHealth>;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activeSeverityIndex, setActiveSeverityIndex] = useState<number>();
  const severity = getSeverityCounts(demoDashboardData);
  const visibleSeverity = severity.filter((item) => item.count);
  const severityTotal = visibleSeverity.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const apiHealthDetail =
    health.api === 'checking'
      ? 'Checking GET /api/health…'
      : health.api === 'healthy'
        ? 'GET /api/health responded successfully'
        : 'GET /api/health failed or timed out';
  const riskItems = incidents.filter(
    (incident) =>
      !['resolved', 'closed'].includes(incident.status) &&
      Date.parse(incident.deadlineAt) <= Date.now() + 60 * 60_000,
  );
  const maxWork = Math.max(
    ...demoDashboardData.analysts.map((analyst) => analyst.capacity),
  );
  return (
    <div className="space-y-5">
      <div className="metric-grid grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Open incidents"
          value={metrics.openIncidents}
          note="Active triage & investigation"
          icon="▤"
          accent="cyan"
          onClick={() => setPage('incidents')}
        />
        <MetricCard
          label="Critical incidents"
          value={metrics.criticalIncidents}
          note="Requires prompt review"
          icon="⚠"
          accent="rose"
          onClick={() => {
            setPage('incidents');
          }}
        />
        <MetricCard
          label="Security alerts"
          value={metrics.totalAlerts}
          note="Across synthetic sources"
          icon="⌁"
          accent="blue"
          onClick={() => setPage('alerts')}
        />
        <MetricCard
          label="SLA risk"
          value={metrics.deadlineRisk}
          note={`${metrics.overdue} overdue · due within 1 hour`}
          icon="◷"
          accent="amber"
          onClick={() => setPage('incidents')}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.9fr)]">
        <Panel>
          <PanelHeading
            title="Alert volume"
            detail="Daily source alerts and incidents · synthetic sample"
            action={
              <span className="rounded-md bg-white/[0.04] px-2 py-1 text-[9px] text-slate-500">
                7 DAYS
              </span>
            }
          />
          <div className="h-[235px] px-2 pb-3 pt-4 sm:px-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={demoDashboardData.volume}
                margin={{ top: 5, right: 12, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="alertFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <filter
                    id="alertGlow"
                    x="-20%"
                    y="-20%"
                    width="140%"
                    height="140%"
                  >
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid
                  stroke="#ffffff10"
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#68778b', fontSize: 10 }}
                  dy={9}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#68778b', fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(23, 33, 27, 0.96)',
                    border: '1px solid rgba(64, 84, 72, 0.9)',
                    borderRadius: 12,
                    color: '#dce7ee',
                    fontSize: 11,
                    boxShadow: '0 14px 40px rgba(0, 0, 0, 0.38)',
                    backdropFilter: 'blur(14px)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="alerts"
                  stroke="#34d399"
                  strokeWidth={2}
                  fill="url(#alertFill)"
                  activeDot={{ r: 4 }}
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={1200}
                  animationEasing="ease-out"
                  filter="url(#alertGlow)"
                />
                <Area
                  type="monotone"
                  dataKey="incidents"
                  stroke="#91a698"
                  strokeWidth={1.5}
                  fill="transparent"
                  activeDot={{ r: 3 }}
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-5 px-5 pb-4 text-[10px] text-slate-500">
            <span className="flex items-center gap-2">
              <i className="live-legend-dot size-1.5 rounded-full bg-cyan-300" />{' '}
              Alerts
            </span>
            <span className="flex items-center gap-2">
              <i className="live-legend-dot legend-violet size-1.5 rounded-full bg-violet-400" />{' '}
              Incidents
            </span>
          </div>
        </Panel>
        <Panel>
          <PanelHeading
            title="Incident severity"
            detail="Current synthetic incident set"
          />
          <div className="flex items-center gap-2 px-2 pt-2">
            <div className="donut-wrap relative h-[190px] w-[56%]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={visibleSeverity}
                    dataKey="count"
                    nameKey="severity"
                    innerRadius="63%"
                    outerRadius="84%"
                    paddingAngle={3}
                    stroke="none"
                    isAnimationActive={!prefersReducedMotion}
                    animationDuration={900}
                    animationEasing="ease-out"
                    activeShape={(props) => (
                      <Sector
                        {...props}
                        outerRadius={Number(props.outerRadius) + 6}
                      />
                    )}
                    onMouseEnter={(_, index) => setActiveSeverityIndex(index)}
                    onMouseLeave={() => setActiveSeverityIndex(undefined)}
                  >
                    {visibleSeverity.map((item) => (
                      <Cell
                        key={item.severity}
                        fill={severityColor[item.severity]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(23, 33, 27, 0.96)',
                      border: '1px solid rgba(64, 84, 72, 0.9)',
                      borderRadius: 12,
                      color: '#dce7ee',
                      fontSize: 11,
                      boxShadow: '0 14px 40px rgba(0, 0, 0, 0.38)',
                      backdropFilter: 'blur(14px)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center" aria-hidden="true">
                <strong>{severityTotal}</strong>
                <span>incidents</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-2.5 pr-4">
              {visibleSeverity.map((item, index) => (
                <div
                  key={item.severity}
                  className={`severity-legend-row flex items-center justify-between gap-3 text-[10px] ${activeSeverityIndex === index ? 'is-active' : ''}`}
                  onMouseEnter={() => setActiveSeverityIndex(index)}
                  onMouseLeave={() => setActiveSeverityIndex(undefined)}
                >
                  <span className="flex items-center gap-2 capitalize text-slate-400">
                    <i
                      className="size-1.5 rounded-full"
                      style={{ background: severityColor[item.severity] }}
                    />
                    {item.severity}
                  </span>
                  <span className="font-medium tabular-nums text-slate-200">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="-mt-3 px-5 pb-4 text-[10px] text-slate-500">
            {incidents.length} incidents in this demonstration
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.9fr)]">
        <Panel>
          <PanelHeading
            title="Recent incidents"
            detail="Select an incident to open the investigation view"
            action={
              <button
                onClick={() => setPage('incidents')}
                className="text-[10px] text-cyan-200 hover:text-cyan-100"
              >
                View queue →
              </button>
            }
          />
          <IncidentTable
            incidents={[...incidents]
              .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
              .slice(0, 4)}
            selectedId={selectedId}
            onSelect={onSelect}
            compact
          />
        </Panel>
        <div className="space-y-5">
          <Panel>
            <PanelHeading
              title="SLA watch"
              detail="Synthetic deadlines · UTC"
            />
            <div className="divide-y divide-white/[0.05]">
              {riskItems.length ? (
                riskItems.map((incident) => (
                  <button
                    key={incident.id}
                    onClick={() => onSelect(incident.id)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-white/[0.025]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-slate-300">
                        {incident.title}
                      </span>
                      <span className="mt-1 block text-[10px] text-slate-600">
                        INC-{incident.id.slice(0, 6).toUpperCase()}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-semibold ${Date.parse(incident.deadlineAt) < Date.now() ? 'text-rose-300' : 'text-amber-200'}`}
                    >
                      {formatDeadline(incident.deadlineAt)}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-5 py-6 text-xs text-slate-500">
                  No active deadlines within one hour.
                </p>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeading
              title="Analyst capacity"
              detail="Fictional team · workload / capacity"
            />
            <div className="space-y-4 px-5 py-4">
              {demoDashboardData.analysts.map((analyst) => (
                <div key={analyst.id}>
                  <div className="mb-1.5 flex items-center justify-between text-[10px]">
                    <span className="text-slate-300">
                      {analyst.displayName}
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {analyst.workload}/{analyst.capacity}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full ${analyst.availability === 'unavailable' ? 'bg-slate-600' : analyst.workload >= analyst.capacity ? 'bg-amber-400' : 'bg-cyan-300'}`}
                      style={{
                        width: `${Math.min(100, (analyst.workload / maxWork) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-600">
              Capacity figures are illustrative, not live staffing data.
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeading
          title="Connected services"
          detail="Live status only where an endpoint supports verification"
        />
        <div className="grid divide-y divide-white/[0.05] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <ServiceCard
            name="Express API"
            state={health.api}
            detail={apiHealthDetail}
          />
          <ServiceCard
            name="PostgreSQL"
            state="unknown"
            detail="API liveness does not check database readiness"
          />
          <ServiceCard
            name="AI service"
            state={health.aiService}
            detail="Private FastAPI service; the dashboard only probes Express."
          />
          <ServiceCard
            name="Gemini provider"
            state={health.geminiProvider}
            detail="Server-side provider; this dashboard does not test Gemini connectivity."
          />
        </div>
      </Panel>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  icon,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  note: string;
  icon: string;
  accent: string;
  onClick: () => void;
}) {
  const animatedValue = useCountUp(value);
  const text: Record<string, string> = {
    cyan: 'text-cyan-200',
    rose: 'text-rose-300',
    blue: 'text-sky-200',
    amber: 'text-amber-200',
  };
  return (
    <button
      onClick={onClick}
      data-accent={accent}
      className="metric-card rounded-2xl border border-white/[0.07] bg-[#101723]/90 p-4 text-left transition sm:p-5"
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-medium text-slate-500 sm:text-[11px]">
          {label}
        </span>
        <span
          className={`metric-icon grid size-8 place-items-center rounded-lg text-sm ${text[accent]}`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-white tabular-nums">
        <span aria-live="off">{animatedValue}</span>
      </div>
      <div className="mt-1.5 text-[9px] text-slate-600 sm:text-[10px]">
        {note}
      </div>
    </button>
  );
}

function IncidentQueue({
  incidents,
  selectedId,
  query,
  severity,
  status,
  setQuery,
  setSeverity,
  setStatus,
  onSelect,
}: {
  incidents: DemoIncident[];
  selectedId: string;
  query: string;
  severity: string;
  status: string;
  setQuery: (value: string) => void;
  setSeverity: (value: string) => void;
  setStatus: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel>
      <PanelHeading
        title="Incident queue"
        detail={`${incidents.length} matching incidents · sorted by latest activity`}
        action={
          <span className="text-[9px] font-semibold tracking-wide text-amber-200">
            SYNTHETIC DATA
          </span>
        }
      />
      <div className="flex flex-wrap gap-2 border-b border-white/[0.06] p-4">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search incidents</span>
          <span className="absolute left-3 top-2 text-slate-600">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or incident ID…"
            className="w-full rounded-lg border border-white/[0.08] bg-[#0b121b] py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
          />
        </label>
        <label>
          <span className="sr-only">Filter by severity</span>
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            className="rounded-lg border border-white/[0.08] bg-[#0b121b] px-3 py-2 text-xs text-slate-300 outline-none"
          >
            <option value="all">All severities</option>
            {[
              'critical',
              'high',
              'medium',
              'low',
              'informational',
              'unknown',
            ].map((item) => (
              <option key={item} value={item}>
                {item[0]!.toUpperCase() + item.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-white/[0.08] bg-[#0b121b] px-3 py-2 text-xs text-slate-300 outline-none"
          >
            <option value="all">All statuses</option>
            {['new', 'triaged', 'investigating', 'resolved', 'closed'].map(
              (item) => (
                <option key={item} value={item}>
                  {item[0]!.toUpperCase() + item.slice(1)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <IncidentTable
        incidents={incidents}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </Panel>
  );
}

function Investigation({ incident }: { incident: DemoIncident }) {
  const analyst = demoDashboardData.analysts.find(
    (item) => item.id === incident.assignedAnalystId,
  );
  const linkedAlerts = demoDashboardData.alerts.filter((alert) =>
    incident.alertIds.includes(alert.id),
  );
  const entities = linkedAlerts.flatMap((alert) =>
    alert.affectedEntities.map((entity) => ({ ...entity, alertId: alert.id })),
  );
  return (
    <div className="space-y-5">
      <Panel className="incident-detail-panel">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
              <span className="font-mono text-[10px] text-slate-500">
                INC-{incident.id.slice(0, 6).toUpperCase()}
              </span>
            </div>
            <h2 className="text-lg font-semibold leading-7 text-white">
              {incident.title}
            </h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              {incident.description}
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">
                Risk score
              </div>
              <div className="mt-1 text-xl font-semibold text-white">
                {incident.riskScore}
                <span className="ml-1 text-[10px] text-slate-500">/100</span>
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">
                Confidence
              </div>
              <div className="mt-1 text-xl font-semibold text-white">
                {Math.round((incident.confidence ?? 0) * 100)}
                <span className="ml-0.5 text-[10px] text-slate-500">%</span>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-0 border-t border-white/[0.06] sm:grid-cols-3 sm:divide-x sm:divide-white/[0.06]">
          <InfoCell label="Risk rationale" value={incident.riskRationale} />
          <InfoCell
            label="Response deadline"
            value={`${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(incident.deadlineAt))} UTC · ${formatDeadline(incident.deadlineAt)}`}
          />
          <InfoCell
            label="Assigned analyst"
            value={
              analyst
                ? `${analyst.displayName} · ${analyst.skills.join(', ')}`
                : 'Unassigned'
            }
          />
        </div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.9fr)]">
        <Panel>
          <PanelHeading
            title="Event timeline"
            detail="Chronological source observations · UTC"
          />
          <div className="space-y-0 px-5 py-3">
            {incident.timeline.map((event, index) => (
              <div
                key={`${event.at}-${index}`}
                className="relative flex gap-4 pb-5 last:pb-2"
              >
                <div className="relative flex w-3 shrink-0 justify-center">
                  <span
                    className={`z-10 mt-1 size-2 rounded-full ${index === 0 ? 'bg-cyan-300' : 'bg-slate-600'}`}
                  />
                  {index < incident.timeline.length - 1 && (
                    <span className="absolute top-3 h-full w-px bg-white/[0.08]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-200">
                      {event.title}
                    </span>
                    <span className="font-mono text-[9px] text-slate-600">
                      {formatTime(event.at)} UTC
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    {event.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHeading
            title="Evidence & uncertainty"
            detail="References identify records; they do not prove claims"
          />
          <div className="space-y-4 p-5">
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Linked alerts · {linkedAlerts.length}
              </div>
              {linkedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="mb-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-200">
                      {alert.title}
                    </span>
                    <SeverityBadge severity={alert.severity} />
                  </div>
                  <div className="mt-2 flex gap-2 text-[9px] text-slate-600">
                    <span>{alert.source}</span>
                    <span>·</span>
                    <span>{formatTime(alert.observedAt)} UTC</span>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                Uncertainty
              </div>
              <p className="text-[11px] leading-5 text-slate-400">
                {incident.uncertainty}
              </p>
            </div>
            {incident.missingEvidence.length > 0 && (
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Missing evidence
                </div>
                <ul className="space-y-1.5">
                  {incident.missingEvidence.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2 text-[10px] text-slate-400"
                    >
                      <span className="text-amber-300">·</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <PanelHeading
            title="Entity relationships"
            detail="Observed links only · edges mirror alert payload fields"
          />
          <div className="space-y-3 p-5">
            {entities.map((entity, index) => (
              <div
                key={`${entity.alertId}-${entity.value}`}
                className="relationship-row flex flex-wrap items-center gap-2 text-[10px]"
              >
                <span className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.05] px-2.5 py-2 text-cyan-100">
                  {entity.value}
                </span>
                <span className="text-slate-600">
                  — {entity.relationship} →
                </span>
                <span className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-2 text-slate-300">
                  {
                    linkedAlerts.find((alert) => alert.id === entity.alertId)
                      ?.title
                  }
                </span>
                <span className="text-[9px] text-slate-600">Observed</span>
                {index < entities.length - 1 && (
                  <span className="sr-only">Next observed relationship</span>
                )}
              </div>
            ))}
            {!entities.length && (
              <p className="text-xs text-slate-500">
                No entity relationships in the selected record.
              </p>
            )}
          </div>
          <div className="entity-legend border-t border-white/[0.06] px-5 py-3 text-[9px] text-slate-500">
            <span>
              <i className="entity-legend-line observed" />
              Solid: observed
            </span>
            <span>
              <i className="entity-legend-line inferred" />
              Dashed: inferred (none shown)
            </span>
          </div>
        </Panel>
        <Panel>
          <PanelHeading
            title="AI-assisted analysis"
            detail="Synthetic illustrative content · no live model connected"
          />
          <div className="p-5">
            <div className="mb-3 inline-flex rounded-md border border-violet-300/15 bg-violet-300/[0.06] px-2 py-1 text-[9px] font-semibold text-violet-200">
              ILLUSTRATIVE · UNVERIFIED
            </div>
            <p className="text-xs leading-5 text-slate-300">
              {incident.riskRationale}
            </p>
            <div className="mt-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Suggested investigation steps
              </div>
              <ol className="space-y-2">
                {incident.suggestedSteps.map((step, index) => (
                  <li
                    key={step}
                    className="flex gap-2 text-[10px] leading-4 text-slate-400"
                  >
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-white/[0.05] text-[9px] text-slate-500">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <p className="mt-4 border-t border-white/[0.06] pt-3 text-[9px] text-slate-600">
              Confidence shown above is part of the synthetic dataset and has
              not been model-validated.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AlertExplorer({
  selectedId,
  onIncident,
}: {
  selectedId: string;
  onIncident: (id: string) => void;
}) {
  return (
    <Panel>
      <PanelHeading
        title="Alert Explorer"
        detail={`${demoDashboardData.alerts.length} synthetic source alerts · preserved source payloads`}
        action={<span className="text-[9px] text-amber-200">DEMO ONLY</span>}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left">
          <thead>
            <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-5 py-3 font-medium">Alert</th>
              <th className="px-3 py-3 font-medium">Source</th>
              <th className="px-3 py-3 font-medium">Severity</th>
              <th className="px-3 py-3 font-medium">Observed</th>
              <th className="px-5 py-3 font-medium">Incident</th>
            </tr>
          </thead>
          <tbody>
            {demoDashboardData.alerts.map((alert) => {
              const incident = demoDashboardData.incidents.find((item) =>
                item.alertIds.includes(alert.id),
              );
              const selected = incident?.id === selectedId;
              return (
                <tr
                  key={alert.id}
                  aria-current={selected ? 'true' : undefined}
                  className={`border-b border-white/[0.04] text-xs ${selected ? 'bg-cyan-300/[0.035]' : ''}`}
                >
                  <td className="max-w-[340px] px-5 py-3.5">
                    <div className="truncate text-slate-200">{alert.title}</div>
                    <div className="mt-1 font-mono text-[9px] text-slate-600">
                      {alert.externalId ?? 'Source event ID unavailable'}
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-slate-400">{alert.source}</td>
                  <td className="px-3 py-3.5">
                    <SeverityBadge severity={alert.severity} />
                  </td>
                  <td className="px-3 py-3.5 font-mono text-[10px] text-slate-500">
                    {formatTime(alert.observedAt)} UTC
                  </td>
                  <td className="px-5 py-3.5">
                    {incident ? (
                      <button
                        onClick={() => onIncident(incident.id)}
                        className="text-[10px] text-cyan-200 hover:underline"
                      >
                        {selected
                          ? 'Selected incident'
                          : `INC-${incident.id.slice(0, 6).toUpperCase()}`}{' '}
                        →
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-600">
                        Ungrouped
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AssignmentView() {
  const assignments = demoDashboardData.assignments;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-[11px] text-amber-100">
        Demonstration recommendation only. No optimizer ran and no assignments
        can be changed here.
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {demoDashboardData.analysts.map((analyst) => (
          <Panel key={analyst.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-medium text-slate-200">
                  {analyst.displayName}
                </h2>
                <p className="mt-1 text-[10px] text-slate-500">
                  {analyst.skills.join(' · ')}
                </p>
              </div>
              <span
                className={`flex items-center gap-1.5 text-[9px] ${analyst.availability === 'available' ? 'text-emerald-300' : 'text-slate-500'}`}
              >
                <HealthDot
                  state={
                    analyst.availability === 'available' ? 'healthy' : 'unknown'
                  }
                />
                {analyst.availability}
              </span>
            </div>
            <div className="mt-5 flex items-end justify-between">
              <span className="text-[10px] text-slate-500">
                Current demo workload
              </span>
              <span className="text-sm tabular-nums text-slate-200">
                {analyst.workload}
                <span className="text-slate-600"> / {analyst.capacity}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-cyan-300"
                style={{
                  width: `${Math.min(100, (analyst.workload / analyst.capacity) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-2 text-[9px] text-slate-600">
              {Math.max(0, analyst.capacity - analyst.workload)} illustrative
              slots remaining
            </div>
          </Panel>
        ))}
      </div>
      <Panel>
        <PanelHeading
          title="Current demonstration assignments"
          detail="From the synthetic dataset · read-only"
        />
        <div className="divide-y divide-white/[0.05]">
          {assignments.map((assignment) => {
            const analyst = demoDashboardData.analysts.find(
              (item) => item.id === assignment.analystId,
            );
            const incident = demoDashboardData.incidents.find(
              (item) => item.id === assignment.incidentId,
            );
            return (
              <div
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div>
                  <p className="text-xs font-medium text-slate-200">
                    {incident?.title}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {analyst?.displayName} · {analyst?.skills.join(', ')}
                  </p>
                </div>
                <span className="max-w-lg text-[10px] leading-4 text-slate-500">
                  {assignment.explanation}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function EvaluationView() {
  const alertSeverity = getAlertSeverityCounts(demoDashboardData);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Demo incidents"
          value={demoDashboardData.incidents.length}
          note="Deterministic dataset rows"
          icon="▤"
          accent="cyan"
          onClick={() => {}}
        />
        <MetricCard
          label="Demo alerts"
          value={demoDashboardData.alerts.length}
          note="Linked across incident records"
          icon="⌁"
          accent="blue"
          onClick={() => {}}
        />
        <MetricCard
          label="Analyst profiles"
          value={demoDashboardData.analysts.length}
          note="Fictional team records"
          icon="♙"
          accent="amber"
          onClick={() => {}}
        />
      </div>
      <Panel>
        <PanelHeading
          title="Dataset coverage"
          detail="Descriptive counts only · no model performance metrics"
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {alertSeverity
            .filter((item) => item.count > 0)
            .map((item) => (
              <div
                key={item.severity}
                className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs"
              >
                <span className="flex items-center gap-2 capitalize text-slate-400">
                  <i
                    className="size-2 rounded-full"
                    style={{ background: severityColor[item.severity] }}
                  />
                  {item.severity} alerts
                </span>
                <b className="text-slate-200">{item.count}</b>
              </div>
            ))}
        </div>
      </Panel>
      <Panel>
        <PanelHeading
          title="Synthetic audit examples"
          detail="Illustrative dataset records · not a durable audit log"
        />
        <div className="divide-y divide-white/[0.05]">
          {demoDashboardData.assignments.map((item) => {
            const incident = demoDashboardData.incidents.find(
              (row) => row.id === item.incidentId,
            );
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
              >
                <span className="text-[11px] text-slate-300">
                  assignment.demo_created
                </span>
                <span className="text-[10px] text-slate-500">
                  INC-{incident?.id.slice(0, 6).toUpperCase()} ·{' '}
                  {formatTime(item.assignedAt)} UTC · synthetic
                </span>
              </div>
            );
          })}
        </div>
        <p className="border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-600">
          These rows are synthetic examples, not audit records. Connect to the
          API for incident-scoped audit history where authorized; no evaluation
          metrics endpoint is available.
        </p>
      </Panel>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-slate-300">{value}</p>
    </div>
  );
}
function HealthRow({ name, state }: { name: string; state: HealthState }) {
  return (
    <div className="mt-3 flex items-center justify-between text-[10px]">
      <span className="text-slate-400">{name}</span>
      <span className="flex items-center gap-1.5 capitalize text-slate-500">
        <HealthDot state={state} />
        {state.replace('-', ' ')}
      </span>
    </div>
  );
}
function ServiceCard({
  name,
  state,
  detail,
}: {
  name: string;
  state: HealthState;
  detail: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-200">{name}</span>
        <span className="flex items-center gap-2 text-[10px] capitalize text-slate-400">
          <HealthDot state={state} />
          {state.replace('-', ' ')}
        </span>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-slate-600">{detail}</p>
    </div>
  );
}
function Logo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
      <path
        d="M12 2.8 14.2 8l5.4-1.6L18 11.8l4 3.9-5.6.4-.8 5.5-3.6-4.4-4.9 2.7 1.1-5.5-5.2-2.1 5.1-2.5-.3-5.6 4.2 3.6L12 2.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
