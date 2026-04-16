import { createLogger } from '@shared/telemetry';
import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';

const log = createLogger('sandbox-worker');

/**
 * Top-level HTTP error handler wired via `app.onError()`.
 *
 * Error shape: { error: string, message: string, details?: object }
 */
export const errorHandler: ErrorHandler = (err, c) => {
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

  log.error({ err, path: c.req.path }, 'unhandled error');
  return c.json(
    {
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    500,
  );
};
