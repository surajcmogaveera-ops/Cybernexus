import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';
import { getApiHealth, getDependencyHealth } from './api.js';
import ConnectedDashboard from './ConnectedDashboard.js';
import type { HealthIndicators } from './use-dependency-health.js';

const health: HealthIndicators = {
  api: 'healthy',
  database: 'unknown',
  aiService: 'unknown',
  geminiProvider: 'disabled',
  geminiConnectivity: 'unverified',
};

describe('CyberNexus dashboard', () => {
  it('renders the dashboard navigation and synthetic data label', () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('CyberNexus');
    expect(markup).toContain('SOC Overview');
    expect(markup).toContain('Alert Explorer');
    expect(markup).toContain('DEMO DATA — SYNTHETIC');
  });

  it('reports AI service and Gemini provider status separately without claiming a connection', () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('AI service');
    expect(markup).toContain('Gemini provider');
    expect(markup).toContain('Configuration only; connectivity unverified.');
    expect(markup).toContain('unverified');
    expect(markup).not.toContain('connected to Gemini');
  });

  it('validates the shared health response contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'ok', service: 'cybernexus-api' }),
        {
          status: 200,
        },
      ),
    );

    await expect(getApiHealth(fetcher)).resolves.toEqual({
      status: 'ok',
      service: 'cybernexus-api',
    });
  });

  it('loads separate database, AI-service, and unverified Gemini status', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        checkedAt: '2026-10-29T10:00:00Z',
        api: { status: 'healthy', verified: true },
        database: { status: 'healthy', verified: true },
        aiService: { status: 'healthy', verified: true },
        aiProvider: {
          analysisMode: 'deterministic',
          geminiConfiguration: 'disabled',
          geminiConnectivity: 'disabled',
          verified: false,
        },
      }),
    );

    await expect(getDependencyHealth(fetcher)).resolves.toMatchObject({
      database: { status: 'healthy', verified: true },
      aiService: { status: 'healthy', verified: true },
      aiProvider: {
        analysisMode: 'deterministic',
        geminiConfiguration: 'disabled',
        geminiConnectivity: 'disabled',
        verified: false,
      },
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('/api/health/dependencies');
  });

  it('uses the standard API error message on failed health requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'The requested resource was not found.',
          },
        }),
        { status: 404 },
      ),
    );

    await expect(getApiHealth(fetcher)).rejects.toThrow(
      'The requested resource was not found.',
    );
  });

  it('aborts a health request when the timeout expires', async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError'),
            );
          });
        }),
    );

    await expect(getApiHealth(fetcher, 1)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('shows truthful connected service states and an honest empty-data state', () => {
    const markup = renderToStaticMarkup(
      <ConnectedDashboard
        token="test-token"
        expressHealthy
        dependencyHealth={health}
        onDisconnect={() => undefined}
        data={{
          session: { subject: 'analyst', scopes: ['api:read'] },
          incidents: [],
          alerts: [],
          assignments: [],
          unavailable: [],
        }}
      />,
    );
    expect(markup).toContain('Express API');
    expect(markup).toContain('healthy');
    expect(markup).toContain('FastAPI service');
    expect(markup).toContain('unknown');
    expect(markup).toContain('Gemini configuration');
    expect(markup).toContain('Gemini connectivity');
    expect(markup).toContain('disabled');
    expect(markup).toContain('unverified');
    expect(markup).toContain('No incidents returned by the API.');
    expect(markup).not.toContain('connected to Gemini');
  });

  it('renders a loading state while an incident workspace is being fetched', () => {
    const markup = renderToStaticMarkup(
      <ConnectedDashboard
        token="test-token"
        expressHealthy
        dependencyHealth={health}
        onDisconnect={() => undefined}
        data={{
          session: { subject: 'analyst', scopes: ['api:read'] },
          incidents: [
            {
              id: '456789ab-cdef-4def-8123-456789abcdef',
              title: 'Live incident',
              status: 'triaged',
              severity: 'high',
              createdAt: '2026-10-29T08:00:00Z',
              updatedAt: '2026-10-29T08:00:00Z',
              alertIds: ['6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0'],
            },
          ],
          alerts: [],
          assignments: [],
          unavailable: [],
        }}
      />,
    );
    expect(markup).toContain('Loading selected incident details');
  });
});
