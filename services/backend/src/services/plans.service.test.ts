import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlansService } from './plans.service';
import { createMockBoss, createMockRedis, createMockLog, createMockPlansRepository } from '../__tests__/mocks';

// ── Minimal DB stub ──────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    status: 'plan_review',
    planReviewHoldUntil: null,
    planRevisionCount: 0,
    maxPlanRevisions: 5,
    ...overrides,
  };
}

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    jobId: 'job-1',
    version: 1,
    status: 'pending',
    previousPlanId: null,
    contentUri: null,
    data: {},
    feedbackFromUser: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDb(job: ReturnType<typeof makeJob> | null = makeJob()) {
  const db: Record<string, unknown> = {
    query: {
      jobs: {
        findFirst: vi.fn().mockResolvedValue(job),
      },
    },
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    // appendTimeline uses db.transaction — simulate with a passthrough
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ seq: 1 }]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
      };
      return fn(tx);
    }),
  };
  return db;
}

// Tracker stub
function makeTracker() {
  return {
    createPlan: vi.fn().mockResolvedValue({ id: 'plan-1' }),
    approvePlan: vi.fn().mockResolvedValue(undefined),
    rejectPlan: vi.fn().mockResolvedValue(undefined),
    recordRevisionRequest: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PlansService.approvePlan', () => {
  let boss: ReturnType<typeof createMockBoss>;
  let redis: ReturnType<typeof createMockRedis>;
  let log: ReturnType<typeof createMockLog>;
  let plansRepo: ReturnType<typeof createMockPlansRepository>;
  let tracker: ReturnType<typeof makeTracker>;

  beforeEach(() => {
    boss = createMockBoss();
    redis = createMockRedis();
    log = createMockLog();
    tracker = makeTracker();
    plansRepo = createMockPlansRepository({ findLatestForJob: makePlan() as never });
  });

  function makeSvc(job = makeJob()) {
    const db = makeDb(job) as never;
    return new PlansService(db, boss as never, log as never, 'redis://localhost:6379', {
      repo: plansRepo as never,
      tracker: tracker as never,
      redis: redis as never,
    });
  }

  it('throws when job does not exist', async () => {
    const db = makeDb(null) as never;
    const svc = new PlansService(db, boss as never, log as never, 'redis://localhost:6379', {
      repo: plansRepo as never,
      tracker: tracker as never,
      redis: redis as never,
    });
    await expect(svc.approvePlan('job-1')).rejects.toThrow('job not found');
  });

  it('throws when job is not in plan_review', async () => {
    const svc = makeSvc(makeJob({ status: 'executing' }));
    await expect(svc.approvePlan('job-1')).rejects.toThrow('job is not in plan_review');
  });

  it('publishes to Redis on hot path (hold still active)', async () => {
    const future = new Date(Date.now() + 60_000);
    const svc = makeSvc(makeJob({ planReviewHoldUntil: future }));
    await svc.approvePlan('job-1');

    expect(redis.publish).toHaveBeenCalledWith(
      'run:job-1:plan-event',
      JSON.stringify({ kind: 'approve' }),
    );
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('enqueues to pg-boss on cold path (hold expired)', async () => {
    const past = new Date(Date.now() - 60_000);
    const svc = makeSvc(makeJob({ planReviewHoldUntil: past }));
    await svc.approvePlan('job-1');

    expect(boss.send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ jobId: 'job-1', resumeMode: 'execute' }),
    );
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('calls tracker.approvePlan with plan id', async () => {
    const svc = makeSvc();
    await svc.approvePlan('job-1');
    expect(tracker.approvePlan).toHaveBeenCalledWith('plan-1');
  });
});

describe('PlansService.revisePlan', () => {
  function makeSvc(job = makeJob(), plan = makePlan()) {
    const db = makeDb(job) as never;
    const plansRepo = createMockPlansRepository({ findLatestForJob: plan as never });
    const tracker = makeTracker();
    const boss = createMockBoss();
    const redis = createMockRedis();
    const log = createMockLog();
    const svc = new PlansService(db, boss as never, log as never, 'redis://localhost:6379', {
      repo: plansRepo as never,
      tracker: tracker as never,
      redis: redis as never,
    });
    return { svc, boss, redis, tracker };
  }

  it('throws BAD_REQUEST when max revisions reached', async () => {
    const { svc } = makeSvc(makeJob({ planRevisionCount: 5, maxPlanRevisions: 5 }));
    await expect(svc.revisePlan('job-1')).rejects.toThrow('max_revisions_reached');
  });

  it('publishes revise event on hot path', async () => {
    const future = new Date(Date.now() + 60_000);
    const { svc, redis } = makeSvc(makeJob({ planReviewHoldUntil: future }));
    await svc.revisePlan('job-1');

    expect(redis.publish).toHaveBeenCalledWith(
      'run:job-1:plan-event',
      JSON.stringify({ kind: 'revise', planVersion: 1 }),
    );
  });

  it('enqueues revise job on cold path', async () => {
    const past = new Date(Date.now() - 60_000);
    const { svc, boss } = makeSvc(makeJob({ planReviewHoldUntil: past }));
    await svc.revisePlan('job-1');

    expect(boss.send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ jobId: 'job-1', resumeMode: 'revise' }),
    );
  });
});

describe('PlansService.rejectPlan', () => {
  function makeSvc(job = makeJob(), plan = makePlan()) {
    const db = makeDb(job) as never;
    const plansRepo = createMockPlansRepository({ findLatestForJob: plan as never });
    const tracker = makeTracker();
    const boss = createMockBoss();
    const redis = createMockRedis();
    const log = createMockLog();
    const svc = new PlansService(db, boss as never, log as never, 'redis://localhost:6379', {
      repo: plansRepo as never,
      tracker: tracker as never,
      redis: redis as never,
    });
    return { svc, tracker, redis, boss };
  }

  it('calls tracker.rejectPlan with plan id and reason', async () => {
    const { svc, tracker } = makeSvc();
    await svc.rejectPlan('job-1', 'wrong approach');
    expect(tracker.rejectPlan).toHaveBeenCalledWith('plan-1', 'wrong approach');
  });

  it('publishes reject event on hot path', async () => {
    const future = new Date(Date.now() + 60_000);
    const { svc, redis } = makeSvc(makeJob({ planReviewHoldUntil: future }));
    await svc.rejectPlan('job-1');
    expect(redis.publish).toHaveBeenCalledWith(
      'run:job-1:plan-event',
      JSON.stringify({ kind: 'reject' }),
    );
  });

  it('does NOT enqueue to boss on cold path (terminal state)', async () => {
    const past = new Date(Date.now() - 60_000);
    const { svc, boss } = makeSvc(makeJob({ planReviewHoldUntil: past }));
    await svc.rejectPlan('job-1');
    expect(boss.send).not.toHaveBeenCalled();
  });
});
