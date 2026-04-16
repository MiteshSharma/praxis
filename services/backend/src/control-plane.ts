import { serve } from '@hono/node-server';
import { getDb } from '@shared/db';
import { createLogger } from '@shared/telemetry';
import { Hono } from 'hono';
import PgBoss from 'pg-boss';
import { env } from './lib/env';
import { cors } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { requestContext } from './middleware/request-context';
import { registerNotifyDispatch } from './queues';
import { registerRoutes } from './routes';
import { buildNotifierRegistry } from './services/notifier.service';

/**
 * Builds the control-plane HTTP app: middleware → routes → notifier
 * consumer, then starts the server. Mirrors the single `buildApp()` pattern
 * from the reference backend, scoped to the control-plane role.
 */
export async function buildControlPlane(): Promise<{ stop: () => Promise<void> }> {
  const log = createLogger('backend:control-plane');
  const db = getDb(env.DATABASE_URL);

  const boss = new PgBoss(env.DATABASE_URL);
  boss.on('error', (err) => log.error({ err }, 'control-plane pg-boss error'));
  await boss.start();

  const registry = buildNotifierRegistry();
  await registerNotifyDispatch(boss, { db, registry, log });

  const app = new Hono();

  // Middleware — order matters
  app.use('*', cors());
  app.use('*', requestContext());
  app.onError(errorHandler(log));

  // Routes
  await registerRoutes(app, { db, boss, log });

  const server = serve({ fetch: app.fetch, port: env.PORT });
  log.info({ port: env.PORT }, 'control-plane listening');

  return {
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await boss.stop({ graceful: true });
    },
  };
}
