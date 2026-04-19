import { ORPCError } from '@orpc/server';
import type { ArtifactDto, JobDto, JobStatus, JobStepDto } from '@shared/contracts';
import { JOB_EXECUTE_QUEUE, TaskIngestService, appendTimeline, splitWebInput } from '@shared/core';
import { type Database, jobs, messages, plans, workflowVersions } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { and, desc, eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { JobsRepository, toJobDto } from '../repositories/jobs.repository';
import { SessionsRepository } from '../repositories/sessions.repository';

const TERMINAL_JOB_STATUSES: JobStatus[] = ['completed', 'plan_rejected', 'failed', 'cancelled'];

interface CreateFromSessionInput {
  sessionId: string;
  task: string;
  githubUrl?: string;
  workflowId?: string;
  autoApprove?: boolean;
}

/**
 * Backend-local jobs service — the thin glue between the routes layer and
 * the role-neutral `@shared/core` ingress. Route handlers stay simple: parse,
 * call this, reply.
 */
export class JobsService {
  private readonly ingest: TaskIngestService;
  private readonly repo: JobsRepository;
  private readonly sessionsRepo: SessionsRepository;

  constructor(
    private readonly db: Database,
    private readonly boss: PgBoss,
    log: Logger,
    overrides?: { ingest?: TaskIngestService; repo?: JobsRepository; sessionsRepo?: SessionsRepository },
  ) {
    this.ingest = overrides?.ingest ?? new TaskIngestService(db, boss, log);
    this.repo = overrides?.repo ?? new JobsRepository(db);
    this.sessionsRepo = overrides?.sessionsRepo ?? new SessionsRepository(db);
  }

  async create(input: CreateFromSessionInput): Promise<JobDto> {
    const session = await this.sessionsRepo.findById(input.sessionId);
    if (!session) throw new ORPCError('NOT_FOUND', { message: 'session not found' });

    const githubUrl = input.githubUrl ?? session.defaultGithubUrl;
    if (!githubUrl) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'no githubUrl provided and session has no default githubUrl',
      });
    }

    const parentJobId = await this.sessionsRepo.findLastCompletedJobId(input.sessionId);
    const { title, description } = splitWebInput(input.task);

    const resolvedWorkflowId = input.workflowId ?? session.defaultWorkflowId ?? null;
    let workflowVersionId: string | undefined;
    if (resolvedWorkflowId) {
      const [latest] = await this.db
        .select({ id: workflowVersions.id })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, resolvedWorkflowId))
        .orderBy(desc(workflowVersions.version))
        .limit(1);
      workflowVersionId = latest?.id;
    }

    const userMsg = await this.sessionsRepo.insertMessage({
      sessionId: input.sessionId,
      role: 'user',
      content: input.task,
    });

    const { id: jobId } = await this.ingest.ingest({
      source: 'web',
      triggerKind: 'user_prompt',
      title,
      description,
      metadata: {},
      githubUrl,
      githubBranch: 'main',
      conversationId: input.sessionId,
      parentJobId: parentJobId ?? undefined,
      workflowVersionId,
      model: session.model ?? null,
      autoApprove: input.autoApprove ?? false,
    });

    await this.sessionsRepo.updateMessageJobId(userMsg.id, jobId);

    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'job not found after creation' });
    return toJobDto(row);
  }

  async getById(jobId: string): Promise<JobDto> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    return toJobDto(row);
  }

  async list(
    limit = 50,
    filters?: { sessionId?: string; status?: JobStatus },
  ): Promise<JobDto[]> {
    return this.repo.findMany(limit, filters);
  }

  async listArtifacts(jobId: string): Promise<ArtifactDto[]> {
    return this.repo.findArtifactsByJobId(jobId);
  }

  async listSteps(jobId: string): Promise<JobStepDto[]> {
    return this.repo.findStepsByJobId(jobId);
  }

  async cancel(jobId: string): Promise<void> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    if (TERMINAL_JOB_STATUSES.includes(row.status as JobStatus)) {
      throw new ORPCError('BAD_REQUEST', { message: 'job is already in a terminal state' });
    }

    await this.db
      .update(jobs)
      .set({
        status: 'cancelled',
        errorMessage: 'Cancelled by user',
        errorCategory: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    await appendTimeline(this.db, jobId, 'status-changed', { from: row.status, to: 'cancelled' });
  }

  async delete(jobId: string): Promise<void> {
    await this.repo.delete(jobId);
  }

  async resumeFromPlan(jobId: string): Promise<{ jobId: string }> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    if (row.status !== 'failed') {
      throw new ORPCError('BAD_REQUEST', { message: 'only failed jobs can be resumed from a plan checkpoint' });
    }

    const plan = await this.db.query.plans.findFirst({
      where: and(eq(plans.jobId, jobId), eq(plans.status, 'approved')),
    });
    if (!plan) {
      throw new ORPCError('BAD_REQUEST', { message: 'no approved plan found — use Restart to run from scratch' });
    }

    await this.db.update(jobs).set({ status: 'queued', updatedAt: new Date() }).where(eq(jobs.id, jobId));
    await this.boss.send(JOB_EXECUTE_QUEUE, { jobId });
    return { jobId };
  }

  async restart(jobId: string): Promise<{ jobId: string }> {
    const original = await this.repo.findById(jobId);
    if (!original) throw new ORPCError('NOT_FOUND', { message: 'job not found' });

    const { id } = await this.ingest.ingest({
      source: 'web',
      triggerKind: 'restart',
      title: original.title,
      description: original.description ?? undefined,
      metadata: { restartedFromJobId: original.id },
      githubUrl: original.githubUrl,
      githubBranch: original.githubBranch,
      workflowVersionId: original.workflowVersionId ?? undefined,
      conversationId: original.conversationId ?? undefined,
    });

    // Re-point any conversation messages that referenced the old job to the new one,
    // so the conversation thread shows the latest run instead of the failed one.
    if (original.conversationId) {
      await this.db
        .update(messages)
        .set({ jobId: id })
        .where(eq(messages.jobId, original.id));
    }

    return { jobId: id };
  }
}
