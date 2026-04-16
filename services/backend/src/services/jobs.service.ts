import { ORPCError } from '@orpc/server';
import type { ArtifactDto, JobDto } from '@shared/contracts';
import { TaskIngestService, splitWebInput } from '@shared/core';
import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type PgBoss from 'pg-boss';
import { JobsRepository, toJobDto } from '../repositories/jobs.repository';

interface CreateJobInput {
  githubUrl: string;
  githubBranch: string;
  input: string;
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
    boss: PgBoss,
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
}
