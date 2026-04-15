import { serve } from '@hono/node-server';
import { OpenAPIGenerator } from '@orpc/openapi';
import { RPCHandler } from '@orpc/server/fetch';
import { ZodToJsonSchemaConverter } from '@orpc/zod';
import { router } from '@shared/contracts';
import { createLogger, requestId } from '@shared/telemetry';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from '../env';

export async function startControlPlane(): Promise<{ stop: () => Promise<void> }> {
  const log = createLogger('backend:control-plane');
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
      exposeHeaders: ['x-request-id'],
      credentials: true,
      maxAge: 600,
    }),
  );
  app.use('*', requestId());

  app.get('/health', (c) =>
    c.json({ status: 'ok', service: 'backend', role: 'control-plane', time: new Date().toISOString() }),
  );
  app.get('/ready', (c) =>
    c.json({ status: 'ok', service: 'backend', role: 'control-plane', time: new Date().toISOString() }),
  );

  const rpc = new RPCHandler(router);
  app.use('/rpc/*', async (c, next) => {
    const { matched, response } = await rpc.handle(c.req.raw, { prefix: '/rpc' });
    if (matched) return response;
    return next();
  });

  const openapiGenerator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  app.get('/openapi.json', async (c) => {
    const spec = await openapiGenerator.generate(router, {
      info: {
        title: 'Praxis API',
        version: process.env.APP_VERSION ?? 'dev',
        description: 'Auto-generated from the oRPC router in @shared/contracts',
      },
      servers: [{ url: `http://localhost:${env.PORT}/rpc` }],
    });
    return c.json(spec);
  });

  app.get('/docs', (c) =>
    c.html(`<!doctype html>
<html>
  <head><title>Praxis API</title><meta charset="utf-8"/></head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`),
  );

  const server = serve({ fetch: app.fetch, port: env.PORT });
  log.info({ port: env.PORT }, 'control-plane listening');

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
