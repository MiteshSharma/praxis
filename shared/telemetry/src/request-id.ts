import type { MiddlewareHandler } from 'hono';

export const REQUEST_ID_HEADER = 'x-request-id';

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming ?? crypto.randomUUID();
    c.set('requestId', id);
    c.header(REQUEST_ID_HEADER, id);
    await next();
  };
}
