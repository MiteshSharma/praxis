import { createLogger, initTelemetry, onShutdown, requestId } from '@shared/telemetry';

initTelemetry('sandbox-worker');

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const log = createLogger('sandbox-worker');
const PORT = Number(process.env.SANDBOX_WORKER_PORT ?? 8787);

const app = new Hono();
app.use('*', requestId());

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'sandbox-worker', time: new Date().toISOString() }),
);
app.get('/ready', (c) =>
  c.json({ status: 'ok', service: 'sandbox-worker', time: new Date().toISOString() }),
);

app.post('/prompt', (c) => c.json({ error: 'not_implemented' }, 501));
app.post('/exec', (c) => c.json({ error: 'not_implemented' }, 501));

const server = serve({ fetch: app.fetch, port: PORT });
log.info({ port: PORT }, 'sandbox-worker started');

onShutdown(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  log.info('sandbox-worker shutdown complete');
});
