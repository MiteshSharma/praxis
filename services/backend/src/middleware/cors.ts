import type { MiddlewareHandler } from 'hono';
import { cors as honoCors } from 'hono/cors';

/**
 * CORS configuration for the control-plane HTTP surface. Dev is permissive;
 * production should tighten `origin` to an allowlist from env.
 */
export function cors(): MiddlewareHandler {
  return honoCors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'last-event-id'],
    exposeHeaders: ['x-request-id'],
    credentials: true,
    maxAge: 600,
  });
}
