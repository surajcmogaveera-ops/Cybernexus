import { describe, expect, it, vi } from 'vitest';
import {
  connectDashboard,
  DashboardApiError,
  getIncidentWorkspace,
  runAssignmentWhatIf,
} from './api.js';

const incidentId = '456789ab-cdef-4def-8123-456789abcdef';
const alertId = '6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0';
const apiIncident = {
  id: incidentId,
  title: 'Synthetic incident from API',
  status: 'triaged',
  severity: 'high',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T08:01:00Z',
  needsHumanReview: true,
  alertIds: [alertId],
};
const apiAlert = {
  id: alertId,
  source: 'synthetic-test',
  externalId: 'event-1',
  title: 'Synthetic alert from API',
  severity: 'high',
  observedAt: '2026-10-29T07:59:00Z',
  ingestedAt: '2026-10-29T08:00:00Z',
  payload: { synthetic: true },
};

function fetcherFor(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = url.split('?')[0]!;
    const body = routes[url] ?? routes[key];
    if (body === undefined)
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Missing.' } }),
        { status: 404 },
      );
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('connected dashboard API client', () => {
  it('loads API incidents, alerts and assignments using bearer authentication', async () => {
    const fetcher = fetcherFor({
      '/api/v1/session': {
        subject: 'analyst',
        scopes: ['api:read', 'audit:read'],
      },
      '/api/v1/incidents': {
        items: [apiIncident],
        page: 1,
        pageSize: 100,
        hasNext: false,
        totalItems: 1,
      },
      '/api/v1/alerts': {
        items: [apiAlert],
        page: 1,
        pageSize: 100,
        hasNext: false,
        totalItems: 1,
      },
      '/api/v1/assignments/current': { assignments: [] },
    });
    const result = await connectDashboard(
      'opaque-test-token-12345678901234567890',
      fetcher,
    );
    expect(result.incidents[0]?.title).toBe('Synthetic incident from API');
    expect(result.alerts?.[0]?.id).toBe(alertId);
    expect(result.assignments).toEqual([]);
    expect(result.unavailable).toEqual([]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/incidents?page=1&pageSize=100',
      expect.objectContaining({
        headers: { authorization: expect.stringMatching(/^Bearer /) },
      }),
    );
  });

  it('does not issue requests when the token is missing', async () => {
    const fetcher = vi.fn();
    await expect(
      connectDashboard(' ', fetcher as unknown as typeof fetch),
    ).rejects.toThrow('Enter an API token');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('surfaces authorization failures without falling back to demo records', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'FORBIDDEN', message: 'The token lacks read access.' },
        }),
        { status: 403 },
      ),
    );
    await expect(
      connectDashboard('opaque-test-token-12345678901234567890', fetcher),
    ).rejects.toMatchObject({
      name: 'DashboardApiError',
      message: 'The token lacks read access.',
      status: 403,
    });
  });

  it('fails closed on invalid API records and does not fabricate missing data', async () => {
    const fetcher = fetcherFor({
      '/api/v1/session': { subject: 'analyst', scopes: ['api:read'] },
      '/api/v1/incidents': {
        items: [{ id: 'invalid' }],
        page: 1,
        pageSize: 100,
        hasNext: false,
        totalItems: 1,
      },
      '/api/v1/alerts': {
        items: [],
        page: 1,
        pageSize: 100,
        hasNext: false,
        totalItems: 0,
      },
      '/api/v1/assignments/current': { assignments: [] },
    });
    await expect(
      connectDashboard('opaque-test-token-12345678901234567890', fetcher),
    ).rejects.toBeInstanceOf(DashboardApiError);
  });

  it('loads missing analysis and audit as unavailable instead of synthetic values', async () => {
    const fetcher = fetcherFor({});
    const workspace = await getIncidentWorkspace('token', incidentId, fetcher);
    expect(workspace.analysis).toBeNull();
    expect(workspace.audit).toBeNull();
    expect(workspace.unavailable).toContain('Timeline');
    expect(workspace.unavailable).toContain('Audit history');
  });

  it('keeps simulations separate by requiring assignmentsPersisted=false', async () => {
    const valid = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ assignmentsPersisted: false, proposed: [] }),
          { status: 200 },
        ),
      );
    await expect(runAssignmentWhatIf('token', valid)).resolves.toMatchObject({
      assignmentsPersisted: false,
    });
    const unsafe = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ assignmentsPersisted: true }), {
        status: 200,
      }),
    );
    await expect(runAssignmentWhatIf('token', unsafe)).rejects.toThrow(
      'safety check',
    );
  });
});
