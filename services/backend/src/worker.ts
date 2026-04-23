import { serve } from '@hono/node-server';
import { getDb, runMigrations } from '@shared/db';
import { LocalSandboxProvider } from '@shared/sandbox';
import { createLogger } from '@shared/telemetry';
import { Hono } from 'hono';
import PgBoss from 'pg-boss';
import { env } from './lib/env';
import { fleets } from '@shared/db';
import { and, notInArray, eq } from 'drizzle-orm';
import {
  registerJobExecute,
  registerRecoverStuck,
  registerFleetOrchestrateWorker,
  scheduleFleetOrchestrator,
} from './queues';

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

  // On startup, cancel any pg-boss jobs left in 'active' state from a previous
  // crashed/killed worker process. Without this, orphaned active slots block
  // the teamSize concurrency limit indefinitely.
  await boss.getDb().executeSql(
    `UPDATE pgboss.job SET state = 'failed', completed_on = NOW(),
     output = '{"error":"orphaned by worker restart"}'::jsonb
     WHERE name = 'job/execute' AND state = 'active'`,
  );

  const sandbox = new LocalSandboxProvider();

  await registerJobExecute(boss, { db, sandbox, log });
  await registerRecoverStuck(boss, { db, log });
  await registerFleetOrchestrateWorker(boss, db, log);

  // Re-register orchestrator pollers for any in-progress orchestrated fleets (crash recovery).
  const activeFleets = await db.query.fleets.findMany({
    where: and(
      eq(fleets.mode, 'orchestrated'),
      notInArray(fleets.status, ['completed', 'failed', 'cancelled', 'draft']),
    ),
    columns: { id: true },
  });
  for (const fleet of activeFleets) {
    await scheduleFleetOrchestrator(boss, fleet.id);
  }
  if (activeFleets.length > 0) {
    log.info({ count: activeFleets.length }, 'recovered orchestrated fleet pollers');
  }

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
