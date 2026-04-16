import { createLogger, initTelemetry, onShutdown } from '@shared/telemetry';

initTelemetry('sandbox-worker');

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { env } from './lib/env';
import { errorHandler } from './middleware/error-handler';
import { requestContext } from './middleware/request-context';
import { registerRoutes } from './routes';
import { AgentService } from './services/agent.service';
import { ExecService } from './services/exec.service';
import { PublishService } from './services/publish.service';

const log = createLogger('sandbox-worker');

const app = new Hono();
app.use('*', requestContext());
app.onError(errorHandler);

registerRoutes(app, {
  agentService: new AgentService(),
  execService: new ExecService(),
  publishService: new PublishService(),
});

const server = serve({ fetch: app.fetch, port: env.PORT });
log.info({ port: env.PORT }, 'sandbox-worker started');

onShutdown(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  log.info('sandbox-worker shutdown complete');
});
