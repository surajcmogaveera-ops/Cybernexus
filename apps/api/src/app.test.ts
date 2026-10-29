import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import {
  AlertInputSchema,
  ApiErrorResponseSchema,
  HealthResponseSchema,
} from '@cybernexus/shared';
import { apiErrorHandler, app, validateBody } from './app.js';

describe('API scaffold', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('returns service health from GET /health', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(HealthResponseSchema.parse(await response.json())).toEqual({
      status: 'ok',
      service: 'cybernexus-api',
    });
  });

  it('returns consistent JSON errors for missing routes and malformed JSON', async () => {
    const missing = await fetch(`${baseUrl}/missing`);
    expect(missing.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(await missing.json()).error.code).toBe(
      'NOT_FOUND',
    );

    const malformed = await fetch(`${baseUrl}/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });
    expect(malformed.status).toBe(400);
    expect(
      ApiErrorResponseSchema.parse(await malformed.json()).error.code,
    ).toBe('MALFORMED_JSON');
  });

  it('rejects JSON bodies that exceed the configured request limit', async () => {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(1_048_577),
    });
    expect(response.status).toBe(413);
    expect(ApiErrorResponseSchema.parse(await response.json()).error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request body exceeds the configured size limit.',
    });
  });

  it('rejects invalid bodies with safe validation details and accepts valid bodies', async () => {
    const validationApp = express();
    validationApp.use(express.json());
    validationApp.post(
      '/alerts',
      validateBody(AlertInputSchema),
      (request, response) => response.status(201).json(request.body),
    );
    validationApp.get('/internal-error', () => {
      throw new Error('private implementation detail');
    });
    validationApp.use(apiErrorHandler);

    const validationServer = validationApp.listen(0);
    await new Promise<void>((resolve) =>
      validationServer.once('listening', resolve),
    );
    const address = validationServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP server address');
    const validationUrl = `http://127.0.0.1:${address.port}/alerts`;

    try {
      const invalid = await fetch(validationUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Missing alert fields' }),
      });
      expect(invalid.status).toBe(400);
      const error = ApiErrorResponseSchema.parse(await invalid.json());
      expect(error.error.code).toBe('VALIDATION_ERROR');
      expect(
        error.error.details?.some(({ path }) => path[0] === 'source'),
      ).toBe(true);
      expect(JSON.stringify(error)).not.toContain('stack');

      const valid = await fetch(validationUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'demo-idp',
          externalId: 'test-alert-1',
          observedAt: '2026-10-28T08:15:00Z',
          title: 'Test alert',
          severity: 'medium',
          payload: { raw: true },
        }),
      });
      expect(valid.status).toBe(201);
      expect(AlertInputSchema.parse(await valid.json()).payload).toEqual({
        raw: true,
      });

      const internalError = await fetch(
        validationUrl.replace('/alerts', '/internal-error'),
      );
      expect(internalError.status).toBe(500);
      const safeError = ApiErrorResponseSchema.parse(
        await internalError.json(),
      );
      expect(safeError.error.message).toBe('An unexpected error occurred.');
      expect(JSON.stringify(safeError)).not.toContain(
        'private implementation detail',
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        validationServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
