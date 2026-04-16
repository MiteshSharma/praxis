import { type Database, jobTimeline, jobs } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { and, eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import type { NormalizedTask } from './task-source';

export const JOB_EXECUTE_QUEUE = 'job/execute';

export class TaskIngestService {
  constructor(
    private readonly db: Database,
    private readonly boss: PgBoss,
    private readonly log: Logger,
  ) {}

  async ingest(normalized: NormalizedTask): Promise<{ id: string; created: boolean }> {
    // Dedup against (source, external_id).
    if (normalized.externalId) {
      const existing = await this.db.query.jobs.findFirst({
        where: and(eq(jobs.source, normalized.source), eq(jobs.externalId, normalized.externalId)),
      });
      if (existing) {
        this.log.info(
          { jobId: existing.id, source: normalized.source, externalId: normalized.externalId },
          'ingress dedup hit, returning existing job',
        );
        return { id: existing.id, created: false };
      }
    }

    const job = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(jobs)
        .values({
          source: normalized.source,
          externalId: normalized.externalId ?? null,
          externalUrl: normalized.externalUrl ?? null,
          title: normalized.title,
          description: normalized.description ?? null,
          metadata: {
            ...normalized.metadata,
            workflowInputs: normalized.workflowInputs ?? {},
          },
          triggerKind: normalized.triggerKind,
          githubUrl: normalized.githubUrl,
          githubBranch: normalized.githubBranch ?? 'main',
          conversationId: normalized.conversationId ?? null,
          parentJobId: normalized.parentJobId ?? null,
          workflowId: normalized.workflowId ?? null,
          workflowVersionId: normalized.workflowVersionId ?? null,
          autoApprove: normalized.autoApprove ?? false,
          status: 'queued',
        })
        .returning();

      if (!row) throw new Error('failed to insert job');

      await tx.insert(jobTimeline).values({
        jobId: row.id,
        seq: 1,
        type: 'job-created',
        payload: {
          source: normalized.source,
          externalId: normalized.externalId ?? null,
        },
      });

      return row;
    });

    await this.boss.send(JOB_EXECUTE_QUEUE, { jobId: job.id });

    this.log.info(
      { jobId: job.id, source: normalized.source, githubUrl: normalized.githubUrl },
      'job ingested and enqueued',
    );

    return { id: job.id, created: true };
  }
}
