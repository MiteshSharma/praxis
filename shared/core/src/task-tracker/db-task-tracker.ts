import { type Database, type Plan, plans } from '@shared/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PlanDraft, PlanStatus, RevisionFeedback, TaskTracker } from './task-tracker';

/**
 * Postgres-backed TaskTracker. Stores the full markdown in `data.bodyMarkdown`
 * (JSONB) and sets `content_uri` to `plans/{jobId}/v{n}` as a logical key
 * (MinIO upload is a Phase 3 concern).
 */
export class DbTaskTracker implements TaskTracker {
  constructor(private readonly db: Database) {}

  async createPlan(jobId: string, draft: PlanDraft): Promise<Plan> {
    const latest = await this.getLatestPlanForJob(jobId);
    const version = (latest?.version ?? 0) + 1;

    const [row] = await this.db
      .insert(plans)
      .values({
        jobId,
        version,
        previousPlanId: draft.previousPlanId ?? null,
        contentUri: `plans/${jobId}/v${version}`,
        data: {
          title: draft.title,
          summary: draft.summary,
          bodyMarkdown: draft.bodyMarkdown,
          steps: draft.steps,
          affectedPaths: draft.affectedPaths,
          risks: draft.risks ?? [],
          openQuestions: draft.openQuestions ?? [],
        },
        status: (draft.openQuestions?.length ?? 0) > 0 ? 'needs_answers' : 'ready',
      })
      .returning();

    if (!row) throw new Error('failed to insert plan');
    return row;
  }

  async getPlan(planId: string): Promise<Plan | null> {
    return (await this.db.query.plans.findFirst({ where: eq(plans.id, planId) })) ?? null;
  }

  async getLatestPlanForJob(jobId: string): Promise<Plan | null> {
    const rows = await this.db
      .select()
      .from(plans)
      .where(eq(plans.jobId, jobId))
      .orderBy(sql`${plans.version} DESC`)
      .limit(1);
    return rows[0] ?? null;
  }

  async approvePlan(planId: string): Promise<Plan> {
    const [row] = await this.db
      .update(plans)
      .set({ status: 'approved', approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(plans.id, planId)))
      .returning();
    if (!row) throw new Error(`plan ${planId} not found`);
    return row;
  }

  async rejectPlan(planId: string, reason?: string): Promise<Plan> {
    const [row] = await this.db
      .update(plans)
      .set({
        status: 'rejected',
        feedbackFromUser: reason ? JSON.stringify({ reason }) : null,
        updatedAt: new Date(),
      })
      .where(eq(plans.id, planId))
      .returning();
    if (!row) throw new Error(`plan ${planId} not found`);
    return row;
  }

  async recordRevisionRequest(planId: string, feedback: RevisionFeedback): Promise<Plan> {
    const [row] = await this.db
      .update(plans)
      .set({
        status: 'rejected',
        feedbackFromUser: JSON.stringify(feedback),
        updatedAt: new Date(),
      })
      .where(eq(plans.id, planId))
      .returning();
    if (!row) throw new Error(`plan ${planId} not found`);
    return row;
  }

  async updatePlanStatus(planId: string, status: PlanStatus): Promise<void> {
    await this.db
      .update(plans)
      .set({ status, updatedAt: new Date() })
      .where(eq(plans.id, planId));
  }

  async listPlansForJob(jobId: string): Promise<Plan[]> {
    return this.db.select().from(plans).where(eq(plans.jobId, jobId)).orderBy(asc(plans.version));
  }
}
