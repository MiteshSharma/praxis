import { JOB_EXECUTE_QUEUE, JobOrchestrator } from '@shared/core';
import type { Database } from '@shared/db';
import type { LocalSandboxProvider } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import type PgBoss from 'pg-boss';

/**
 * Worker-side consumer for `job/execute`. Drives each job through the
 * `JobOrchestrator` happy path.
 */
export async function registerJobExecute(
  boss: PgBoss,
  deps: {
    db: Database;
    sandbox: LocalSandboxProvider;
    log: Logger;
  },
): Promise<void> {
  const orchestrator = new JobOrchestrator({
    db: deps.db,
    boss,
    sandbox: deps.sandbox,
    log: deps.log,
  });

  await boss.createQueue(JOB_EXECUTE_QUEUE);
  await boss.work<{ jobId: string }>(JOB_EXECUTE_QUEUE, async (batch) => {
    for (const item of batch) {
      await orchestrator.run(item.data.jobId);
    }
  });

  deps.log.info({ queue: JOB_EXECUTE_QUEUE }, 'job-execute consumer started');
}
