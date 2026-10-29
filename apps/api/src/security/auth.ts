import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  ApiGatewayErrorResponseSchema,
  ApiScopeSchema,
  type ApiScope,
} from '@cybernexus/shared';

const CredentialSchema = z
  .object({
    token: z
      .string()
      .min(32)
      .max(512)
      .regex(/^[A-Za-z0-9._~+/=-]+$/),
    subject: z.string().trim().min(1).max(120),
    scopes: z.array(ApiScopeSchema).min(1).max(10),
  })
  .strict();

export type ApiCredential = z.infer<typeof CredentialSchema>;

export type ApiAuthConfiguration =
  | { status: 'ready'; credentials: readonly ApiCredential[] }
  | { status: 'missing' | 'invalid' };

type Principal = { subject: string; scopes: readonly ApiScope[] };

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function loadApiAuthConfiguration(
  raw = process.env.CYBERNEXUS_API_TOKENS_JSON,
): ApiAuthConfiguration {
  if (!raw?.trim()) return { status: 'missing' };

  try {
    const parsed = z
      .array(CredentialSchema)
      .min(1)
      .max(100)
      .parse(JSON.parse(raw) as unknown);
    const hashes = parsed.map(({ token }) => digest(token).toString('hex'));
    if (new Set(hashes).size !== hashes.length) return { status: 'invalid' };
    return { status: 'ready', credentials: parsed };
  } catch {
    return { status: 'invalid' };
  }
}

export function createApiAuthConfiguration(
  credentials: readonly ApiCredential[],
): ApiAuthConfiguration {
  const parsed = z
    .array(CredentialSchema)
    .min(1)
    .max(100)
    .safeParse(credentials);
  if (!parsed.success) return { status: 'invalid' };
  const hashes = parsed.data.map(({ token }) => digest(token).toString('hex'));
  if (new Set(hashes).size !== hashes.length) return { status: 'invalid' };
  return { status: 'ready', credentials: parsed.data };
}

export function sendGatewayError(
  response: Parameters<RequestHandler>[1],
  status: number,
  code: z.infer<typeof ApiGatewayErrorResponseSchema>['error']['code'],
  message: string,
): void {
  response
    .status(status)
    .json(ApiGatewayErrorResponseSchema.parse({ error: { code, message } }));
}

export function createAuthenticationMiddleware(
  configuration: ApiAuthConfiguration,
): RequestHandler {
  return (request, response, next) => {
    if (configuration.status !== 'ready') {
      sendGatewayError(
        response,
        503,
        'AUTHENTICATION_UNAVAILABLE',
        'API authentication is not configured.',
      );
      return;
    }

    const authorization = request.get('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9._~+/=-]{32,512})$/i.exec(authorization);
    if (!match) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendGatewayError(
        response,
        401,
        'AUTHENTICATION_REQUIRED',
        'A valid bearer token is required.',
      );
      return;
    }

    const suppliedDigest = digest(match[1]!);
    let principal: Principal | undefined;
    for (const credential of configuration.credentials) {
      const matches = timingSafeEqual(suppliedDigest, digest(credential.token));
      if (matches) principal = credential;
    }

    if (!principal) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendGatewayError(
        response,
        401,
        'AUTHENTICATION_REQUIRED',
        'A valid bearer token is required.',
      );
      return;
    }

    response.locals.principal = {
      subject: principal.subject,
      scopes: [...principal.scopes],
    } satisfies Principal;
    next();
  };
}

export function requireScopes(...requiredScopes: ApiScope[]): RequestHandler {
  return (_request, response, next) => {
    const principal = response.locals.principal as Principal | undefined;
    if (!principal) {
      sendGatewayError(
        response,
        401,
        'AUTHENTICATION_REQUIRED',
        'A valid bearer token is required.',
      );
      return;
    }

    if (!requiredScopes.every((scope) => principal.scopes.includes(scope))) {
      sendGatewayError(
        response,
        403,
        'FORBIDDEN',
        'The authenticated principal lacks the required permission.',
      );
      return;
    }
    next();
  };
}
