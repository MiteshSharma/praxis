import { ORPCError } from '@orpc/server';
import type { ArtifactDto, JobDto, JobStepDto } from '@shared/contracts';
import { JOB_EXECUTE_QUEUE, TaskIngestService, splitWebInput } from '@shared/core';
import { type Database, jobs, plans } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { and, eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { JobsRepository, toJobDto } from '../repositories/jobs.repository';

interface CreateJobInput {
  githubUrl: string;
  githubBranch: string;
  input: string;
  workflowVersionId?: string;
}

/**
 * Backend-local jobs service — the thin glue between the routes layer and
 * the role-neutral `@shared/core` ingress. Route handlers stay simple: parse,
 * call this, reply.
 */
export class JobsService {
  private readonly ingest: TaskIngestService;
  private readonly repo: JobsRepository;

  constructor(
    private readonly db: Database,
    private readonly boss: PgBoss,
    log: Logger,
  ) {
    this.ingest = new TaskIngestService(db, boss, log);
    this.repo = new JobsRepository(db);
  }

  async create(input: CreateJobInput): Promise<{ jobId: string }> {
    const { title, description } = splitWebInput(input.input);
    const { id } = await this.ingest.ingest({
      source: 'web',
      triggerKind: 'user_prompt',
      title,
      description,
      metadata: {},
      githubUrl: input.githubUrl,
      githubBranch: input.githubBranch,
      workflowVersionId: input.workflowVersionId,
    });
    return { jobId: id };
  }

  async getById(jobId: string): Promise<JobDto> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    return toJobDto(row);
  }

  async list(limit = 50): Promise<JobDto[]> {
    return this.repo.findMany(limit);
  }

  async listArtifacts(jobId: string): Promise<ArtifactDto[]> {
    return this.repo.findArtifactsByJobId(jobId);
  }

  async listSteps(jobId: string): Promise<JobStepDto[]> {
    return this.repo.findStepsByJobId(jobId);
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

    return { jobId: id };
  }
}
