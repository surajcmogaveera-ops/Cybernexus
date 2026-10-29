import {
  IncidentAnalysisRequestSchema,
  IncidentAnalysisResultSchema,
  type IncidentAnalysisRequest,
  type IncidentAnalysisResult,
} from '@cybernexus/shared';

const MAX_ANALYSIS_SERVICE_BYTES = 1_048_576;
const ANALYSIS_SERVICE_TIMEOUT_MS = 3_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class AnalysisServiceUnavailable extends Error {
  constructor() {
    super('Analysis service is unavailable.');
    this.name = 'AnalysisServiceUnavailable';
  }
}

export class InvalidAnalysisServiceResponse extends Error {
  constructor() {
    super('Analysis service returned an invalid response.');
    this.name = 'InvalidAnalysisServiceResponse';
  }
}

export type IncidentAnalysisService = {
  analyze(request: IncidentAnalysisRequest): Promise<IncidentAnalysisResult>;
};

export type IncidentAnalysisServiceOptions = {
  baseUrl?: string;
  token?: string;
  fetchImplementation?: typeof fetch;
};

export function createIncidentAnalysisServiceClient(
  options: IncidentAnalysisServiceOptions = {},
): IncidentAnalysisService {
  const baseUrl = options.baseUrl ?? process.env.AI_SERVICE_URL;
  const token = options.token ?? process.env.CYBERNEXUS_AI_SERVICE_TOKEN;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    async analyze(rawRequest) {
      const request = IncidentAnalysisRequestSchema.parse(rawRequest);
      if (!baseUrl || !token || token.length < 32 || token.length > 512) {
        throw new AnalysisServiceUnavailable();
      }

      let endpoint: URL;
      try {
        const parsedBase = new URL(baseUrl);
        const loopback = LOOPBACK_HOSTS.has(parsedBase.hostname.toLowerCase());
        if (
          !['http:', 'https:'].includes(parsedBase.protocol) ||
          parsedBase.username ||
          parsedBase.password ||
          parsedBase.search ||
          parsedBase.hash ||
          (parsedBase.protocol === 'http:' && !loopback)
        ) {
          throw new Error('Invalid private analysis service origin.');
        }
        endpoint = new URL('/internal/v1/incident-analyses', parsedBase);
      } catch {
        throw new AnalysisServiceUnavailable();
      }

      const body = JSON.stringify(request);
      if (Buffer.byteLength(body, 'utf8') > MAX_ANALYSIS_SERVICE_BYTES) {
        throw new AnalysisServiceUnavailable();
      }

      let response: Response;
      try {
        response = await fetchImplementation(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(ANALYSIS_SERVICE_TIMEOUT_MS),
        });
      } catch {
        throw new AnalysisServiceUnavailable();
      }
      if (!response.ok) throw new AnalysisServiceUnavailable();

      try {
        const result = IncidentAnalysisResultSchema.parse(
          await readBoundedJson(response),
        );
        if (result.requestId !== request.requestId) {
          throw new Error('Analysis response request ID mismatch.');
        }
        return result;
      } catch {
        throw new InvalidAnalysisServiceResponse();
      }
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_ANALYSIS_SERVICE_BYTES) {
    await response.body?.cancel();
    throw new Error('Analysis response exceeds the configured size limit.');
  }
  if (!response.body) throw new Error('Missing analysis response body.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_ANALYSIS_SERVICE_BYTES) {
      await reader.cancel();
      throw new Error('Analysis response exceeds the configured size limit.');
    }
    chunks.push(value);
  }
  return JSON.parse(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
  ) as unknown;
}
