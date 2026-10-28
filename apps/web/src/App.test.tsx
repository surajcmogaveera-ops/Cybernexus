import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';
import { getApiHealth } from './api.js';

describe('CyberNexus scaffold', () => {
  it('renders the CyberNexus landing page', () => {
    expect(renderToStaticMarkup(<App />)).toContain('CyberNexus');
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
});
