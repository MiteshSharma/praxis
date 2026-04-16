import { type Database, jobs } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { appendTimeline } from './transitions';

const NON_TERMINAL_RUNNING = [
  'provisioning',
  'preparing',
  'building',
  'executing',
  'checking',
  'learning',
  'finalizing',
] as const;

/**
 * Find jobs stuck in a running state with stale `updated_at` and either
 * retry them (if under max_retries) or mark them failed.
 */
export async function recoverStuckJobs(db: Database, log: Logger): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);

  const stuck = await db
    .select()
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, NON_TERMINAL_RUNNING as unknown as string[]),
        lt(jobs.updatedAt, cutoff),
      ),
    );

  let recovered = 0;
  for (const row of stuck) {
    if (row.retryCount < row.maxRetries) {
      await db
        .update(jobs)
        .set({
          status: 'queued',
          retryCount: row.retryCount + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, row.id), eq(jobs.status, row.status)));
      await appendTimeline(db, row.id, 'recovered', {
        from: row.status,
        retryCount: row.retryCount + 1,
      });
      log.warn({ jobId: row.id, from: row.status }, 'recovered stuck job to queued');
    } else {
      await db
        .update(jobs)
        .set({
          status: 'failed',
          errorMessage: 'stuck job exceeded max retries',
          errorCategory: 'permanent',
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, row.id), eq(jobs.status, row.status)));
      await appendTimeline(db, row.id, 'status-changed', {
        from: row.status,
        to: 'failed',
        reason: 'max_retries',
      });
      log.error({ jobId: row.id }, 'stuck job exceeded max retries');
    }
    recovered += 1;
  }
  return recovered;
}
