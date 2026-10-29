import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CorrelationRequestSchema,
  CorrelationResultSchema,
} from '@cybernexus/shared';
import {
  CorrelationServiceUnavailable,
  createCorrelationServiceClient,
} from './service-client.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/shared/fixtures/correlation-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { request: unknown; result: unknown };
const request = CorrelationRequestSchema.parse(fixture.request);
const result = CorrelationResultSchema.parse(fixture.result);
const token = 'phase-nine-correlation-service-token-32-chars';

describe('private correlation service client', () => {
  it('sends the versioned request with service authentication and validates the response', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8000/internal/v1/correlations',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${token}`,
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createCorrelationServiceClient({
      baseUrl: 'http://127.0.0.1:8000',
      token,
      fetchImplementation,
    });
    await expect(client.correlate(request)).resolves.toEqual(result);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('fails closed when token configuration, transport, or response is unsafe', async () => {
    const missing = createCorrelationServiceClient({
      baseUrl: 'http://127.0.0.1:8000',
      token: '',
    });
    await expect(missing.correlate(request)).rejects.toBeInstanceOf(
      CorrelationServiceUnavailable,
    );

    const remoteHttp = createCorrelationServiceClient({
      baseUrl: 'http://internal-service.example:8000',
      token,
    });
    await expect(remoteHttp.correlate(request)).rejects.toBeInstanceOf(
      CorrelationServiceUnavailable,
    );

    const mismatch = createCorrelationServiceClient({
      baseUrl: 'http://127.0.0.1:8000',
      token,
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...result,
              requestId: 'd80036f4-7fe9-4b9a-b420-41d8fa8e86ac',
            }),
            {
              status: 200,
            },
          ),
      ),
    });
    await expect(mismatch.correlate(request)).rejects.toBeInstanceOf(
      CorrelationServiceUnavailable,
    );

    const offline = createCorrelationServiceClient({
      baseUrl: 'http://127.0.0.1:8000',
      token,
      fetchImplementation: vi.fn(async () => {
        throw new Error('private transport details');
      }),
    });
    await expect(offline.correlate(request)).rejects.toBeInstanceOf(
      CorrelationServiceUnavailable,
    );
  });
});
