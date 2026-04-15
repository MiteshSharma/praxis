import { serve } from '@hono/node-server';
import { createLogger } from '@shared/telemetry';
import { Hono } from 'hono';
import PgBoss from 'pg-boss';
import { env } from '../env';

export async function startWorker(): Promise<{ stop: () => Promise<void> }> {
  const log = createLogger('backend:worker');

  const boss = new PgBoss(env.DATABASE_URL);
  boss.on('error', (err) => log.error({ err }, 'pg-boss error'));
  await boss.start();

  await boss.createQueue('hello');
  await boss.work('hello', async (jobs) => {
    for (const job of jobs) {
      log.info({ jobId: job.id, data: job.data }, 'hello job processed');
    }
  });

  const health = new Hono();
  health.get('/health', (c) =>
    c.json({ status: 'ok', service: 'backend', role: 'worker', time: new Date().toISOString() }),
  );
  health.get('/ready', (c) =>
    c.json({ status: 'ok', service: 'backend', role: 'worker', time: new Date().toISOString() }),
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
