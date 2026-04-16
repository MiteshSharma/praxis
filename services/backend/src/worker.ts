import { serve } from '@hono/node-server';
import { getDb, runMigrations } from '@shared/db';
import { LocalSandboxProvider } from '@shared/sandbox';
import { createLogger } from '@shared/telemetry';
import { Hono } from 'hono';
import PgBoss from 'pg-boss';
import { env } from './lib/env';
import { registerJobExecute, registerRecoverStuck } from './queues';

/**
 * Builds the worker app: runs migrations, starts pg-boss, registers
 * consumers + cron, and exposes a tiny health server on a dedicated port.
 */
export async function buildWorker(): Promise<{ stop: () => Promise<void> }> {
  const log = createLogger('backend:worker');

  const applied = await runMigrations(env.DATABASE_URL);
  if (applied.length > 0) log.info({ applied }, 'migrations applied');

  const db = getDb(env.DATABASE_URL);
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on('error', (err) => log.error({ err }, 'worker pg-boss error'));
  await boss.start();

  const sandbox = new LocalSandboxProvider();

  await registerJobExecute(boss, { db, sandbox, log });
  await registerRecoverStuck(boss, { db, log });

  // Tiny health surface — only reason the worker binds a port at all.
  const health = new Hono();
  health.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'backend',
      role: 'worker',
      time: new Date().toISOString(),
    }),
  );
  health.get('/ready', (c) =>
    c.json({
      status: 'ok',
      service: 'backend',
      role: 'worker',
      time: new Date().toISOString(),
    }),
  );

  const healthServer = serve({ fetch: health.fetch, port: env.WORKER_HEALTH_PORT });
  log.info({ port: env.WORKER_HEALTH_PORT }, 'worker health listening');

  return {
    stop: async () => {
      await new Promise<void>((resolve) => healthServer.close(() => resolve()));
      await boss.stop({ graceful: true });
    },
  };
}
