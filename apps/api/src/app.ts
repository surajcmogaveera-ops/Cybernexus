import cors from 'cors';
import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import {
  ApiErrorResponseSchema,
  HealthResponseSchema,
} from '@cybernexus/shared';

export const app: express.Express = express();
app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173' }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_request, response) =>
  response.json(
    HealthResponseSchema.parse({ status: 'ok', service: 'cybernexus-api' }),
  ),
);

export function validateBody(schema: z.ZodType): RequestHandler {
  return (request, response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request body did not match the expected format.',
            details: result.error.issues.map(({ path, message }) => ({
              path,
              message,
            })),
          },
        }),
      );
      return;
    }

    request.body = result.data;
    next();
  };
}

app.use((_request, response) =>
  response.status(404).json(
    ApiErrorResponseSchema.parse({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    }),
  ),
);

export const apiErrorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const malformedJson = error instanceof SyntaxError && 'body' in error;
  const code = malformedJson ? 'MALFORMED_JSON' : 'INTERNAL_SERVER_ERROR';
  const message = malformedJson
    ? 'Request body must contain valid JSON.'
    : 'An unexpected error occurred.';

  response
    .status(malformedJson ? 400 : 500)
    .json(ApiErrorResponseSchema.parse({ error: { code, message } }));
};

app.use(apiErrorHandler);
