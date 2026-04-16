import type { Context, Next } from 'hono';
import type { ZodSchema } from 'zod';

/**
 * Validates `req.body` (parsed JSON) against `schema`.
 * On failure: 400 with standardised error shape { error, message, details }.
 *
 * Usage:
 *   app.post('/prompt', validateBody(PromptBodySchema), handler)
 */
export function validateBody(schema: ZodSchema) {
  return async (c: Context, next: Next) => {
    const raw = await c.req.json().catch(() => null);
    const result = schema.safeParse(raw);
    if (!result.success) {
      return c.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
    c.set('body' as never, result.data);
    return next();
  };
}

/**
 * Validates URL path parameters against `schema`.
 *
 * Usage:
 *   app.get('/jobs/:id', validateParams(ParamsSchema), handler)
 */
export function validateParams(schema: ZodSchema) {
  return async (c: Context, next: Next) => {
    const result = schema.safeParse(c.req.param());
    if (!result.success) {
      return c.json(
        {
          error: 'VALIDATION_ERROR',
          message: 'Invalid path parameters',
          details: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
    c.set('params' as never, result.data);
    return next();
  };
}
