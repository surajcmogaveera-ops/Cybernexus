import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';
import { getApiHealth } from './api.js';
import ConnectedDashboard from './ConnectedDashboard.js';

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
    expect(markup).toContain(
      'Private FastAPI service; the dashboard only probes Express.',
    );
    expect(markup).toContain(
      'Server-side provider; this dashboard does not test Gemini connectivity.',
    );
    expect(markup.toLowerCase()).not.toContain('not connected');
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
    expect(markup).toContain('Healthy');
    expect(markup).toContain('FastAPI service');
    expect(markup).toContain('Unknown');
    expect(markup).toContain('Gemini configuration');
    expect(markup).toContain('Gemini connectivity');
    expect(markup).toContain('Not verified');
    expect(markup).toContain('No incidents returned by the API.');
    expect(markup).not.toContain('connected to Gemini');
  });

  it('renders a loading state while an incident workspace is being fetched', () => {
    const markup = renderToStaticMarkup(
      <ConnectedDashboard
        token="test-token"
        expressHealthy
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
