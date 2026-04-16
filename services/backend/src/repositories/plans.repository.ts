import type { PlanDto } from '@shared/contracts';
import { type Database, type Plan, plans } from '@shared/db';
import { asc, desc, eq } from 'drizzle-orm';

export class PlansRepository {
  constructor(private readonly db: Database) {}

  async findById(planId: string): Promise<Plan | undefined> {
    return this.db.query.plans.findFirst({ where: eq(plans.id, planId) });
  }

  async findLatestForJob(jobId: string): Promise<Plan | undefined> {
    const rows = await this.db
      .select()
      .from(plans)
      .where(eq(plans.jobId, jobId))
      .orderBy(desc(plans.version))
      .limit(1);
    return rows[0];
  }

  async findAllForJob(jobId: string): Promise<Plan[]> {
    return this.db.select().from(plans).where(eq(plans.jobId, jobId)).orderBy(asc(plans.version));
  }
}

export function toPlanDto(row: Plan): PlanDto {
  return {
    id: row.id,
    jobId: row.jobId,
    version: row.version,
    previousPlanId: row.previousPlanId,
    contentUri: row.contentUri,
    data: row.data as PlanDto['data'],
    status: row.status as PlanDto['status'],
    feedbackFromUser: row.feedbackFromUser,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
