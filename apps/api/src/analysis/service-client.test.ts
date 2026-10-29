import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { IncidentAnalysisRequestSchema } from '@cybernexus/shared';
import {
  AnalysisServiceUnavailable,
  InvalidAnalysisServiceResponse,
  createIncidentAnalysisServiceClient,
} from './service-client.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/shared/fixtures/incident-analysis-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { request: unknown; result: unknown };
const request = IncidentAnalysisRequestSchema.parse(fixture.request);
const token = 'phase-ten-internal-service-test-token-32-characters';

describe('private incident analysis service client', () => {
  it('sends only the validated incident snapshot using the internal bearer token', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8000/internal/v1/incident-analyses',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${token}`,
      );
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return Response.json(fixture.result);
    });
    const client = createIncidentAnalysisServiceClient({
      baseUrl: 'http://127.0.0.1:8000',
      token,
      fetchImplementation,
    });
    await expect(client.analyze(request)).resolves.toEqual(fixture.result);
  });

  it('fails safely when configuration is absent, the service is offline, or HTTP is remote', async () => {
    await expect(
      createIncidentAnalysisServiceClient({ baseUrl: '', token: '' }).analyze(
        request,
      ),
    ).rejects.toBeInstanceOf(AnalysisServiceUnavailable);
    await expect(
      createIncidentAnalysisServiceClient({
        baseUrl: 'http://example.test',
        token,
      }).analyze(request),
    ).rejects.toBeInstanceOf(AnalysisServiceUnavailable);
    const offline = createIncidentAnalysisServiceClient({
      baseUrl: 'http://localhost:8000',
      token,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('private error')),
    });
    await expect(offline.analyze(request)).rejects.toBeInstanceOf(
      AnalysisServiceUnavailable,
    );
  });

  it('rejects mismatched, malformed, and self-validated service output', async () => {
    const badResults = [
      {
        ...(fixture.result as object),
        requestId: '10000000-0000-4000-8000-000000000099',
      },
      {
        ...(fixture.result as object),
        validationStatus: 'references_validated',
      },
      {
        ...(fixture.result as object),
        findings: [
          {
            ...(fixture.result as { findings: Record<string, unknown>[] })
              .findings[0]!,
            verificationStatus: 'verified',
          },
        ],
      },
    ];
    for (const badResult of badResults) {
      const client = createIncidentAnalysisServiceClient({
        baseUrl: 'http://localhost:8000',
        token,
        fetchImplementation: vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json(badResult)),
      });
      await expect(client.analyze(request)).rejects.toBeInstanceOf(
        InvalidAnalysisServiceResponse,
      );
    }
  });
});
