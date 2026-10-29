import { describe, expect, it } from 'vitest';
import { rewriteApiProxyPath } from './api-proxy.js';

describe('Vite API health proxy rewrite', () => {
  it('rewrites Express liveness and dependency health paths', () => {
    expect(rewriteApiProxyPath('/api/health')).toBe('/health');
    expect(rewriteApiProxyPath('/api/health/dependencies')).toBe(
      '/health/dependencies',
    );
  });

  it('leaves versioned API paths and unrelated health-like paths unchanged', () => {
    expect(rewriteApiProxyPath('/api/v1/incidents')).toBe('/api/v1/incidents');
    expect(rewriteApiProxyPath('/api/healthful')).toBe('/api/healthful');
  });
});
