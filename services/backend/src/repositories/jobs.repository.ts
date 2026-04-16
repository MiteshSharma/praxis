import type { ArtifactDto, JobDto } from '@shared/contracts';
import { type Database, artifacts, jobs } from '@shared/db';
import { desc, eq } from 'drizzle-orm';

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
  };
}
