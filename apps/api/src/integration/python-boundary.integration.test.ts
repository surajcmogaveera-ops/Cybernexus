import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CorrelationRequestSchema,
  IncidentAnalysisRequestSchema,
} from '@cybernexus/shared';
import { createApp } from '../app.js';
import { createIncidentAnalysisServiceClient } from '../analysis/service-client.js';
import { createCorrelationServiceClient } from '../correlation/service-client.js';

const correlationFixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/shared/fixtures/correlation-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { request: unknown };
const analysisFixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/shared/fixtures/incident-analysis-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { request: unknown };
const correlationRequest = CorrelationRequestSchema.parse(
  correlationFixture.request,
);
const analysisRequest = IncidentAnalysisRequestSchema.parse(
  analysisFixture.request,
);
const serviceToken = randomBytes(32).toString('base64url');
const apiToken = randomBytes(32).toString('base64url');
const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const pythonSource = fileURLToPath(
  new URL('../../../../services/ai/src', import.meta.url),
);

describe('real Express-to-FastAPI HTTP boundary', () => {
  let python: ChildProcess;
  let fastApiPort: number;
  let fastApiUrl: string;
  let apiServer: HttpServer;
  let apiUrl: string;

  beforeAll(async () => {
    fastApiPort = await reservePort();
    fastApiUrl = `http://127.0.0.1:${fastApiPort}`;
    python = spawn(
      process.env.PYTHON ?? 'python',
      [
        '-m',
        'uvicorn',
        'cybernexus_ai.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(fastApiPort),
        '--app-dir',
        pythonSource,
        '--log-level',
        'error',
      ],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PYTHONPATH: pythonSource,
          AI_PROVIDER: 'deterministic',
          GEMINI_LIVE_ENABLED: 'false',
          CYBERNEXUS_AI_SERVICE_TOKEN: serviceToken,
        },
        stdio: 'ignore',
      },
    );
    await waitForHealth(fastApiUrl, python);

    const app = createApp({
      credentials: [
        {
          token: apiToken,
          subject: 'phase13-synthetic-analyst',
          scopes: ['api:read', 'api:write'],
        },
      ],
      correlationService: createCorrelationServiceClient({
        baseUrl: fastApiUrl,
        token: serviceToken,
      }),
      incidentAnalysisService: createIncidentAnalysisServiceClient({
        baseUrl: fastApiUrl,
        token: serviceToken,
      }),
    });
    apiServer = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      apiServer.once('listening', resolve);
      apiServer.once('error', reject);
    });
    const address = apiServer.address() as AddressInfo;
    apiUrl = `http://127.0.0.1:${address.port}`;
  }, 20_000);

  afterAll(async () => {
    if (apiServer) {
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    }
    if (python && python.exitCode === null) {
      python.kill();
      await new Promise<void>((resolve) => {
        python.once('exit', () => resolve());
        setTimeout(resolve, 2_000).unref();
      });
    }
  });

  it('sends correlation through the real client and receives a validated candidate', async () => {
    const response = await createCorrelationServiceClient({
      baseUrl: fastApiUrl,
      token: serviceToken,
    }).correlate(correlationRequest);
    expect(response).toMatchObject({
      contractVersion: 'v1',
      requestId: correlationRequest.requestId,
    });
    expect(response.relationships).toHaveLength(1);
    expect(response.relationships[0]).toMatchObject({
      status: 'proposed',
      evidence: [
        {
          sourceField: 'normalizedAttributes.userId',
          targetField: 'normalizedAttributes.userId',
        },
      ],
    });
    expect(response.relationships[0]?.rationale).toContain('candidate');

    const timestampOnly = CorrelationRequestSchema.parse({
      ...correlationRequest,
      alerts: correlationRequest.alerts.map((alert) => ({
        ...alert,
        entities: [],
      })),
    });
    await expect(
      createCorrelationServiceClient({
        baseUrl: fastApiUrl,
        token: serviceToken,
      }).correlate(timestampOnly),
    ).resolves.toMatchObject({ relationships: [] });
  });

  it('sends analysis through the real client and receives fallback with scoped references and uncertainty', async () => {
    const result = await createIncidentAnalysisServiceClient({
      baseUrl: fastApiUrl,
      token: serviceToken,
    }).analyze(analysisRequest);
    expect(result).toMatchObject({
      contractVersion: 'v1',
      requestId: analysisRequest.requestId,
      analysisMethod: 'deterministic_fallback',
      needsHumanReview: true,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      result.findings.every(
        (finding) => finding.verificationStatus === 'unverified',
      ),
    ).toBe(true);
    expect(
      result.findings
        .flatMap(({ evidence }) => evidence)
        .every(
          ({ id }) =>
            analysisRequest.alerts.some((alert) => alert.id === id) ||
            analysisRequest.relationships.some(
              (relationship) => relationship.id === id,
            ),
        ),
    ).toBe(true);
    expect(result.missingInformation.length).toBeGreaterThan(0);
  });

  it('rejects missing internal credentials and keeps public API auth in Express', async () => {
    const unauthorizedInternal = await fetch(
      `${fastApiUrl}/internal/v1/correlations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(correlationRequest),
      },
    );
    expect(unauthorizedInternal.status).toBe(401);

    const wrongInternalCredential = await fetch(
      `${fastApiUrl}/internal/v1/correlations`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${randomBytes(32).toString('base64url')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(correlationRequest),
      },
    );
    expect(wrongInternalCredential.status).toBe(401);

    const invalidInternalBody = await fetch(
      `${fastApiUrl}/internal/v1/correlations`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${serviceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contractVersion: 'unexpected',
          requestId: 'bad',
        }),
      },
    );
    expect(invalidInternalBody.status).toBe(422);
    expect(await invalidInternalBody.text()).not.toContain('unexpected');

    for (const path of [
      '/api/v1/correlation/run',
      `/api/v1/incidents/${analysisRequest.incidentId}/analysis`,
    ]) {
      const response = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: path.endsWith('/correlation/run')
          ? JSON.stringify({
              alertIds: correlationRequest.alerts.map(({ id }) => id),
            })
          : '{}',
      });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(serviceToken);
    }

    expect(python.exitCode).toBeNull();
  });
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('FastAPI test process exited before becoming ready.');
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('FastAPI test process did not become ready in time.');
}
