import { recoverStuckJobs } from '@shared/core';
import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type PgBoss from 'pg-boss';

export const RECOVER_QUEUE = 'job/recover-stuck';

/**
 * Cron that sweeps jobs whose `updated_at` has gone stale in a non-terminal
 * running state and either requeues them or permanently fails them.
 */
export async function registerRecoverStuck(
  boss: PgBoss,
  deps: { db: Database; log: Logger },
): Promise<void> {
  await boss.createQueue(RECOVER_QUEUE);
  await boss.schedule(RECOVER_QUEUE, '*/2 * * * *');
  await boss.work(RECOVER_QUEUE, async () => {
    const n = await recoverStuckJobs(deps.db, deps.log);
    if (n > 0) deps.log.warn({ count: n }, 'recovered stuck jobs');
  });
  deps.log.info({ queue: RECOVER_QUEUE }, 'recover-stuck cron scheduled');
}
