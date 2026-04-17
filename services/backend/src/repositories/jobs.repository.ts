import type { ArtifactDto, JobDto, JobStepDto } from '@shared/contracts';
import { type Database, artifacts, jobSteps, jobs } from '@shared/db';
import { asc, desc, eq } from 'drizzle-orm';

export class JobsRepository {
  constructor(private readonly db: Database) {}

  async findById(jobId: string): Promise<typeof jobs.$inferSelect | undefined> {
    return this.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  }

  async findMany(limit: number): Promise<JobDto[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .orderBy(desc(jobs.createdAt))
      .limit(limit);
    return rows.map(toJobDto);
  }

  async findStepsByJobId(jobId: string): Promise<JobStepDto[]> {
    const rows = await this.db
      .select()
      .from(jobSteps)
      .where(eq(jobSteps.jobId, jobId))
      .orderBy(asc(jobSteps.stepIndex));
    return rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      stepIndex: r.stepIndex,
      retryOf: r.retryOf,
      kind: r.kind,
      name: r.name,
      config: (r.config ?? {}) as Record<string, unknown>,
      status: r.status,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      output: (r.output ?? null) as Record<string, unknown> | null,
      errorMessage: r.errorMessage,
    }));
  }

  async delete(jobId: string): Promise<void> {
    await this.db.delete(jobs).where(eq(jobs.id, jobId));
  }

  async findArtifactsByJobId(jobId: string): Promise<ArtifactDto[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.jobId, jobId))
      .orderBy(desc(artifacts.createdAt));
    return rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      kind: r.kind,
      path: r.path,
      url: r.url,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

export function toJobDto(row: typeof jobs.$inferSelect): JobDto {
  return {
    id: row.id,
    conversationId: row.conversationId ?? null,
    source: row.source,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    title: row.title,
    description: row.description,
    triggerKind: row.triggerKind,
    githubUrl: row.githubUrl,
    githubBranch: row.githubBranch,
    githubCommitSha: row.githubCommitSha,
    status: row.status as JobDto['status'],
    errorMessage: row.errorMessage,
    errorCategory: row.errorCategory,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    totalInputTokens: row.totalInputTokens ?? null,
    totalOutputTokens: row.totalOutputTokens ?? null,
    totalCostUsd: row.totalCostUsd ?? null,
  };
}
