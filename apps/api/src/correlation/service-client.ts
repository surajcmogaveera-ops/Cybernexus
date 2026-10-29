import {
  CorrelationRequestSchema,
  CorrelationResultSchema,
  type CorrelationRequest,
  type CorrelationResult,
} from '@cybernexus/shared';
import { isValidInternalServiceToken } from '../security/internal-service-token.js';

const MAX_SERVICE_RESPONSE_BYTES = 1_048_576;
const SERVICE_TIMEOUT_MS = 3_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class CorrelationServiceUnavailable extends Error {
  constructor() {
    super('Correlation service is unavailable.');
    this.name = 'CorrelationServiceUnavailable';
  }
}

export type CorrelationService = {
  correlate(request: CorrelationRequest): Promise<CorrelationResult>;
};

export type CorrelationServiceOptions = {
  baseUrl?: string;
  token?: string;
  fetchImplementation?: typeof fetch;
};

export function createCorrelationServiceClient(
  options: CorrelationServiceOptions = {},
): CorrelationService {
  const baseUrl = options.baseUrl ?? process.env.AI_SERVICE_URL;
  const token = options.token ?? process.env.CYBERNEXUS_AI_SERVICE_TOKEN;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    async correlate(rawRequest) {
      const request = CorrelationRequestSchema.parse(rawRequest);
      if (!baseUrl || !token || !isValidInternalServiceToken(token)) {
        throw new CorrelationServiceUnavailable();
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
          throw new Error('Invalid internal service origin.');
        }
        endpoint = new URL('/internal/v1/correlations', parsedBase);
      } catch {
        throw new CorrelationServiceUnavailable();
      }

      const requestBody = JSON.stringify(request);
      if (Buffer.byteLength(requestBody, 'utf8') > MAX_SERVICE_RESPONSE_BYTES) {
        throw new CorrelationServiceUnavailable();
      }

      let response: Response;
      try {
        response = await fetchImplementation(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: requestBody,
          signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
        });
      } catch {
        throw new CorrelationServiceUnavailable();
      }
      if (!response.ok) throw new CorrelationServiceUnavailable();

      try {
        const rawResponse = await readBoundedJson(response);
        const result = CorrelationResultSchema.parse(rawResponse);
        if (result.requestId !== request.requestId) {
          throw new Error('Correlation response request ID mismatch.');
        }
        return result;
      } catch {
        throw new CorrelationServiceUnavailable();
      }
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_SERVICE_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('Correlation response exceeds the configured size limit.');
  }
  if (!response.body) throw new Error('Missing correlation response body.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SERVICE_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(
        'Correlation response exceeds the configured size limit.',
      );
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return JSON.parse(body.toString('utf8')) as unknown;
}
