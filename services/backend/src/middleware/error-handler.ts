import { ORPCError } from '@orpc/server';
import type { Logger } from '@shared/telemetry';
import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';

/**
 * Top-level HTTP error handler wired via `app.onError()`.
 *
 * Error shape: { error: string, message: string, details?: object }
 *
 * oRPC handles its own errors inside the RPC handler — this catches anything
 * that escapes to the Hono layer (unhandled Zod throws, ORPCError re-throws,
 * unexpected service exceptions).
 */
export function errorHandler(log: Logger): ErrorHandler {
  return (err, c) => {
    if (err instanceof ZodError) {
      return c.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.flatten().fieldErrors,
        },
        400,
      );
    }

    if (err instanceof ORPCError) {
      const status = orpcStatusMap[err.code as keyof typeof orpcStatusMap] ?? 400;
      return c.json({ error: err.code, message: err.message }, status);
    }

    log.error({ err, path: c.req.path }, 'unhandled error');
    return c.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
      500,
    );
  };
}

const orpcStatusMap = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;
