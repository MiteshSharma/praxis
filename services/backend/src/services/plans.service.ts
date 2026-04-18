import { ORPCError } from '@orpc/server';
import type { PlanDto } from '@shared/contracts';
import { DbTaskTracker, JOB_EXECUTE_QUEUE, appendTimeline } from '@shared/core';
import { type Database, jobs } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import type PgBoss from 'pg-boss';
import { PlansRepository, toPlanDto } from '../repositories/plans.repository';

export class PlansService {
  private readonly repo: PlansRepository;
  private readonly tracker: DbTaskTracker;
  private readonly redis: Redis;

  constructor(
    private readonly db: Database,
    private readonly boss: PgBoss,
    private readonly log: Logger,
    redisUrl: string,
    overrides?: { repo?: PlansRepository; tracker?: DbTaskTracker; redis?: Redis },
  ) {
    this.repo = overrides?.repo ?? new PlansRepository(db);
    this.tracker = overrides?.tracker ?? new DbTaskTracker(db);
    this.redis = overrides?.redis ?? new Redis(redisUrl);
  }

  async getLatestPlan(jobId: string): Promise<PlanDto | null> {
    const row = await this.repo.findLatestForJob(jobId);
    return row ? toPlanDto(row) : null;
  }

  async listPlans(jobId: string): Promise<PlanDto[]> {
    const rows = await this.repo.findAllForJob(jobId);
    return rows.map(toPlanDto);
  }

  async approvePlan(jobId: string): Promise<void> {
    const job = await this.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    if (job.status !== 'plan_review') {
      throw new ORPCError('BAD_REQUEST', { message: `job is not in plan_review (current: ${job.status})` });
    }

    const plan = await this.repo.findLatestForJob(jobId);
    if (!plan) throw new ORPCError('NOT_FOUND', { message: 'no plan found for job' });

    await this.tracker.approvePlan(plan.id);
    await this.appendTimeline(jobId, 'plan-approved', { planId: plan.id, version: plan.version });

    // Hot path: publish wake signal if sandbox is still held
    const isHot = job.planReviewHoldUntil && job.planReviewHoldUntil > new Date();
    if (isHot) {
      await this.redis.publish(`run:${jobId}:plan-event`, JSON.stringify({ kind: 'approve' }));
    } else {
      // Cold path: enqueue fresh job
      await this.boss.send(JOB_EXECUTE_QUEUE, { jobId, resumeMode: 'execute' });
    }
  }

  async revisePlan(
    jobId: string,
    answers?: Record<string, string>,
    additionalFeedback?: string,
  ): Promise<void> {
    const job = await this.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    if (job.status !== 'plan_review') {
      throw new ORPCError('BAD_REQUEST', { message: `job is not in plan_review (current: ${job.status})` });
    }

    const revisionCount = job.planRevisionCount ?? 0;
    const maxRevisions = job.maxPlanRevisions ?? 5;
    if (revisionCount >= maxRevisions) {
      throw new ORPCError('BAD_REQUEST', { message: 'max_revisions_reached' });
    }

    const plan = await this.repo.findLatestForJob(jobId);
    if (!plan) throw new ORPCError('NOT_FOUND', { message: 'no plan found for job' });

    await this.tracker.recordRevisionRequest(plan.id, { answers, additionalFeedback });
    await this.db
      .update(jobs)
      .set({ planRevisionCount: revisionCount + 1, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await this.appendTimeline(jobId, 'plan-revision-requested', {
      planId: plan.id,
      version: plan.version,
      revisionCount: revisionCount + 1,
    });

    const isHot = job.planReviewHoldUntil && job.planReviewHoldUntil > new Date();
    if (isHot) {
      await this.redis.publish(
        `run:${jobId}:plan-event`,
        JSON.stringify({ kind: 'revise', planVersion: plan.version }),
      );
    } else {
      await this.boss.send(JOB_EXECUTE_QUEUE, { jobId, resumeMode: 'revise' });
    }
  }

  async rejectPlan(jobId: string, reason?: string): Promise<void> {
    const job = await this.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    if (job.status !== 'plan_review') {
      throw new ORPCError('BAD_REQUEST', { message: `job is not in plan_review (current: ${job.status})` });
    }

    const plan = await this.repo.findLatestForJob(jobId);
    if (!plan) throw new ORPCError('NOT_FOUND', { message: 'no plan found for job' });

    await this.tracker.rejectPlan(plan.id, reason);
    await this.appendTimeline(jobId, 'plan-rejected', { planId: plan.id, reason: reason ?? null });

    const isHot = job.planReviewHoldUntil && job.planReviewHoldUntil > new Date();
    if (isHot) {
      await this.redis.publish(`run:${jobId}:plan-event`, JSON.stringify({ kind: 'reject' }));
    }
    // Cold: no need to enqueue — plan_rejected is terminal
  }

  private async appendTimeline(
    jobId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await appendTimeline(this.db, jobId, type, payload);
  }
}
