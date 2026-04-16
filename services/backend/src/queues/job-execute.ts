import { JOB_EXECUTE_QUEUE, JobOrchestrator, type ResumeMode } from '@shared/core';
import type { Database } from '@shared/db';
import type { LocalSandboxProvider } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import type PgBoss from 'pg-boss';
import { env } from '../lib/env';

interface JobExecutePayload {
  jobId: string;
  resumeMode?: ResumeMode;
}

/**
 * Worker-side consumer for `job/execute`. Drives each job through the
 * `JobOrchestrator` — initial runs and cold resumes (execute | revise).
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
    redisUrl: env.REDIS_URL,
    mcpEndpoint: env.CONTROL_PLANE_MCP_URL,
    mcpSecret: env.MCP_SHARED_SECRET,
  });

  await boss.createQueue(JOB_EXECUTE_QUEUE);
  await boss.work<JobExecutePayload>(JOB_EXECUTE_QUEUE, async (batch) => {
    for (const item of batch) {
      await orchestrator.run(item.data.jobId, item.data.resumeMode);
    }
  });

  deps.log.info({ queue: JOB_EXECUTE_QUEUE }, 'job-execute consumer started');
}
