// @shared/core triggers self-registration of channels + memory backends on import
import { JOB_EXECUTE_QUEUE, JobOrchestrator, type ResumeMode, memoryBackendRegistry, secretBackendRegistry } from '@shared/core';
import type { Database } from '@shared/db';
import { jobs, messages } from '@shared/db';
import type { SandboxProvider } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { env } from '../lib/env';
import { FleetsService } from '../services/fleets.service';

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
    sandbox: SandboxProvider;
    log: Logger;
  },
): Promise<void> {
  const fleetsService = new FleetsService(deps.db, boss, deps.log);

  // pg-boss v10 enforces expireInSeconds < 24 h (strict); use 23 h 59 m to cover the
  // full plan-review hold window without exceeding the limit.
  await boss.createQueue(JOB_EXECUTE_QUEUE, { expireInSeconds: 23 * 60 * 60 + 59 * 60 });

  // teamSize: allow multiple jobs to run concurrently. Without this, a job
  // blocked in holdForPlanReview occupies the single worker slot, preventing
  // all other jobs from being picked up.
  await boss.work<JobExecutePayload>(JOB_EXECUTE_QUEUE, { teamSize: 8 }, async (batch) => {
    for (const item of batch) {
      const { jobId } = item.data;

      // Create a fresh orchestrator per job so cost/token state never bleeds
      // between concurrent runs.
      const memoryBackend = memoryBackendRegistry.create(env.MEMORY_BACKEND, { db: deps.db });
      const secretBackend = secretBackendRegistry.create(env.SECRET_BACKEND, { db: deps.db });
      const orchestrator = new JobOrchestrator({
        db: deps.db,
        boss,
        sandbox: deps.sandbox,
        log: deps.log,
        redisUrl: env.REDIS_URL,
        mcpEndpoint: env.CONTROL_PLANE_MCP_URL,
        mcpSecret: env.MCP_SHARED_SECRET,
        controlPlaneUrl: env.CONTROL_PLANE_URL ?? `http://localhost:${env.PORT}`,
        memoryBackend,
        secretBackend,
      });

      await orchestrator.run(jobId, item.data.resumeMode);

      // Fleet notification hook: if this job was created from a fleet_job message,
      // notify the fleet consumer so it can update status and spawn the next job.
      try {
        const [jobRow] = await deps.db
          .select({ messageId: jobs.messageId })
          .from(jobs)
          .where(eq(jobs.id, jobId));

        if (jobRow?.messageId) {
          const [msg] = await deps.db
            .select({ fleetJobId: messages.fleetJobId })
            .from(messages)
            .where(eq(messages.id, jobRow.messageId));

          if (msg?.fleetJobId) {
            await fleetsService.onJobComplete(msg.fleetJobId, jobId);
          }
        }
      } catch (err) {
        deps.log.warn({ err, jobId }, 'fleet notification hook failed — ignoring');
      }
    }
  });

  deps.log.info({ queue: JOB_EXECUTE_QUEUE }, 'job-execute consumer started');
}
