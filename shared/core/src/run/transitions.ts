import type { JobStatus } from '@shared/contracts';
import { type Database, jobTimeline, jobs } from '@shared/db';
import { and, eq, sql } from 'drizzle-orm';

export interface TransitionResult {
  from: JobStatus;
  to: JobStatus;
  seq: number;
}

/**
 * Atomically updates a job's status and appends a `status-changed` row to
 * `job_timeline`. Returns the newly-written seq for use by
 * `emitNotification`, or null if the transition was rejected because the
 * `expectedFrom` status didn't match (conflict).
 */
export async function transitionJob(
  db: Database,
  jobId: string,
  expectedFrom: JobStatus,
  to: JobStatus,
  patch: Partial<{
    startedAt: Date;
    completedAt: Date;
    githubCommitSha: string;
    errorMessage: string;
    errorCategory: string;
  }> = {},
): Promise<TransitionResult | null> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(jobs)
      .set({
        status: to,
        updatedAt: new Date(),
        ...patch,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, expectedFrom)))
      .returning();

    if (!updated) return null;

    const [{ seq }] = await tx
      .select({ seq: sql<number>`COALESCE(MAX(seq), 0) + 1` })
      .from(jobTimeline)
      .where(eq(jobTimeline.jobId, jobId));

    await tx.insert(jobTimeline).values({
      jobId,
      seq,
      type: 'status-changed',
      payload: { from: expectedFrom, to },
    });

    return { from: expectedFrom, to, seq };
  });
}

export async function appendTimeline(
  db: Database,
  jobId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [{ seq }] = await tx
      .select({ seq: sql<number>`COALESCE(MAX(seq), 0) + 1` })
      .from(jobTimeline)
      .where(eq(jobTimeline.jobId, jobId));

    await tx.insert(jobTimeline).values({ jobId, seq, type, payload });
    return seq;
  });
}
