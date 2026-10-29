import { describe, expect, it } from 'vitest';
import { loadQpiAIOptConfiguration } from './qpiai-opt-config.js';

describe('QpiAI Opt server configuration', () => {
  it('distinguishes missing from invalid settings without exposing a token', () => {
    expect(loadQpiAIOptConfiguration({})).toEqual({ status: 'missing' });
    const token = 'secret-value-that-must-never-be-returned';
    const result = loadQpiAIOptConfiguration({
      QPIAI_OPT_BASE_URL: 'http://localhost:8080/api',
      QPIAI_OPT_API_TOKEN: token,
    });
    expect(result).toEqual({ status: 'invalid' });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('accepts only the documented HTTPS service base and keeps the token server-side', () => {
    const token = 'opaque-test-token-1234567890';
    const result = loadQpiAIOptConfiguration({
      QPIAI_OPT_BASE_URL: 'https://opt-server.qpiai.tech/api',
      QPIAI_OPT_API_TOKEN: token,
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.baseUrl.origin).toBe('https://opt-server.qpiai.tech');
      expect(result.baseUrl.pathname).toBe('/api');
      expect(result.token).toBe(token);
    }
    expect(
      loadQpiAIOptConfiguration({
        QPIAI_OPT_BASE_URL: 'https://example.invalid/api',
        QPIAI_OPT_API_TOKEN: token,
      }),
    ).toEqual({ status: 'invalid' });
  });
});
