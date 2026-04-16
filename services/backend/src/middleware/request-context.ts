import { REQUEST_ID_HEADER } from '@shared/telemetry';
import type { MiddlewareHandler } from 'hono';

/**
 * Attaches a request id to every request. Reuses the inbound `x-request-id`
 * header when present, otherwise generates a fresh UUID. The id is exposed
 * on the response header for the caller to correlate.
 */
export function requestContext(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming ?? crypto.randomUUID();
    c.set('requestId', id);
    c.header(REQUEST_ID_HEADER, id);
    await next();
  };
}
