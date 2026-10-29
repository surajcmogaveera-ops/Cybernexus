import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { sendGatewayError } from './auth.js';

export type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  maxTrackedClients: number;
  now: () => number;
};

const defaultRateLimitOptions: RateLimitOptions = {
  windowMs: 60_000,
  maxRequests: 120,
  maxTrackedClients: 10_000,
  now: Date.now,
};

export const requestIdMiddleware: RequestHandler = (
  _request,
  response,
  next,
) => {
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('X-Request-ID', requestId);
  next();
};

export function createRateLimitMiddleware(
  overrides: Partial<RateLimitOptions> = {},
): RequestHandler {
  const options = { ...defaultRateLimitOptions, ...overrides };
  if (
    !Number.isSafeInteger(options.windowMs) ||
    options.windowMs < 1 ||
    !Number.isSafeInteger(options.maxRequests) ||
    options.maxRequests < 1 ||
    !Number.isSafeInteger(options.maxTrackedClients) ||
    options.maxTrackedClients < 1
  ) {
    throw new Error('Invalid API rate limit configuration.');
  }
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextExpirySweep = 0;

  return (request, response, next) => {
    const now = options.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let window = windows.get(key);

    if (!window || window.resetAt <= now) {
      if (windows.size >= options.maxTrackedClients && now >= nextExpirySweep) {
        let nextExpiry = Number.POSITIVE_INFINITY;
        for (const [client, entry] of windows) {
          if (entry.resetAt <= now) windows.delete(client);
          else nextExpiry = Math.min(nextExpiry, entry.resetAt);
        }
        nextExpirySweep = Number.isFinite(nextExpiry)
          ? nextExpiry
          : now + options.windowMs;
      }
      if (!windows.has(key) && windows.size >= options.maxTrackedClients) {
        sendRateLimitError(response, options, now);
        return;
      }
      window = { count: 0, resetAt: now + options.windowMs };
      windows.set(key, window);
    }

    window.count += 1;
    const remaining = Math.max(0, options.maxRequests - window.count);
    response.setHeader('RateLimit-Limit', String(options.maxRequests));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader(
      'RateLimit-Reset',
      String(Math.ceil(window.resetAt / 1000)),
    );

    if (window.count > options.maxRequests) {
      sendRateLimitError(response, options, now, window.resetAt);
      return;
    }
    next();
  };
}

function sendRateLimitError(
  response: Parameters<RequestHandler>[1],
  options: RateLimitOptions,
  now: number,
  resetAt = now + options.windowMs,
): void {
  response.setHeader(
    'Retry-After',
    String(Math.max(1, Math.ceil((resetAt - now) / 1000))),
  );
  sendGatewayError(
    response,
    429,
    'RATE_LIMITED',
    'The request limit has been reached. Try again later.',
  );
}
