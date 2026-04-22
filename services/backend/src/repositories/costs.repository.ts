import type { CostSummaryDto, DailyCostDto, RepoCostDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { jobs } from '@shared/db';
import { and, gte, isNotNull, lte, sql } from 'drizzle-orm';

function dateFilters(from?: string, to?: string) {
  const conditions = [isNotNull(jobs.totalCostUsd)];
  if (from) conditions.push(gte(jobs.createdAt, new Date(from)));
  if (to) conditions.push(lte(jobs.createdAt, new Date(to)));
  return and(...conditions);
}

export class CostsRepository {
  constructor(private readonly db: Database) {}

  async getSummary(from?: string, to?: string): Promise<CostSummaryDto> {
    const [row] = await this.db
      .select({
        totalCostUsd: sql<number>`coalesce(sum(${jobs.totalCostUsd}), 0)`,
        totalJobs: sql<number>`count(*)`,
        completedJobs: sql<number>`count(*) filter (where ${jobs.status} = 'completed')`,
        failedJobs: sql<number>`count(*) filter (where ${jobs.status} = 'failed')`,
        totalInputTokens: sql<number>`coalesce(sum(${jobs.totalInputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${jobs.totalOutputTokens}), 0)`,
      })
      .from(jobs)
      .where(dateFilters(from, to));

    const totalCostUsd = Number(row.totalCostUsd);
    const totalJobs = Number(row.totalJobs);

    return {
      totalCostUsd,
      avgCostPerJob: totalJobs > 0 ? totalCostUsd / totalJobs : 0,
      totalJobs,
      completedJobs: Number(row.completedJobs),
      failedJobs: Number(row.failedJobs),
      totalInputTokens: Number(row.totalInputTokens),
      totalOutputTokens: Number(row.totalOutputTokens),
    };
  }

  async getDaily(from?: string, to?: string): Promise<DailyCostDto[]> {
    const rows = await this.db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${jobs.createdAt}), 'YYYY-MM-DD')`,
        costUsd: sql<number>`coalesce(sum(${jobs.totalCostUsd}), 0)`,
        jobCount: sql<number>`count(*)`,
      })
      .from(jobs)
      .where(dateFilters(from, to))
      .groupBy(sql`date_trunc('day', ${jobs.createdAt})`)
      .orderBy(sql`date_trunc('day', ${jobs.createdAt})`);

    return rows.map((r) => ({
      date: r.date,
      costUsd: Number(r.costUsd),
      jobCount: Number(r.jobCount),
    }));
  }

  async getByRepo(from?: string, to?: string): Promise<RepoCostDto[]> {
    const rows = await this.db
      .select({
        githubUrl: jobs.githubUrl,
        costUsd: sql<number>`coalesce(sum(${jobs.totalCostUsd}), 0)`,
        jobCount: sql<number>`count(*)`,
      })
      .from(jobs)
      .where(dateFilters(from, to))
      .groupBy(jobs.githubUrl)
      .orderBy(sql`sum(${jobs.totalCostUsd}) desc nulls last`)
      .limit(20);

    return rows.map((r) => {
      const costUsd = Number(r.costUsd);
      const jobCount = Number(r.jobCount);
      return {
        githubUrl: r.githubUrl,
        costUsd,
        jobCount,
        avgCostUsd: jobCount > 0 ? costUsd / jobCount : 0,
      };
    });
  }
}
