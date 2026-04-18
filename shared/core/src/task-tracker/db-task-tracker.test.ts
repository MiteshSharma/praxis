import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbTaskTracker } from './db-task-tracker';
import type { PlanDraft } from './task-tracker';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_DRAFT: PlanDraft = {
  title: 'Add OAuth login',
  summary: 'Implement GitHub OAuth2 flow',
  bodyMarkdown: '## Steps\n1. Set up routes\n2. Add callback handler',
  steps: [{ id: 'step-1', name: 'Setup routes', description: 'Add /auth/github routes' }],
  affectedPaths: ['src/routes/auth.ts'],
  risks: ['Token expiry edge cases'],
  openQuestions: [],
};

function makePlanRow(overrides: Partial<{
  id: string;
  version: number;
  status: string;
  feedbackFromUser: string | null;
  approvedAt: Date | null;
}> = {}) {
  return {
    id: overrides.id ?? 'plan-1',
    jobId: 'job-1',
    version: overrides.version ?? 1,
    status: overrides.status ?? 'ready',
    data: { title: 'Add OAuth login', bodyMarkdown: '## Steps', openQuestions: [] },
    contentUri: 'plans/job-1/v1',
    previousPlanId: null,
    feedbackFromUser: overrides.feedbackFromUser ?? null,
    approvedAt: overrides.approvedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeDb(options: {
  existingPlanForLatest?: ReturnType<typeof makePlanRow> | null;
  insertReturning?: ReturnType<typeof makePlanRow>;
  updateReturning?: ReturnType<typeof makePlanRow>;
  plans?: ReturnType<typeof makePlanRow>[];
} = {}) {
  const insertedPlan = options.insertReturning ?? makePlanRow();
  const updatedPlan = options.updateReturning ?? makePlanRow();

  return {
    query: {
      plans: {
        findFirst: vi.fn().mockResolvedValue(options.existingPlanForLatest ?? null),
      },
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(
      options.existingPlanForLatest !== undefined
        ? options.existingPlanForLatest !== null ? [options.existingPlanForLatest] : []
        : [],
    ),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertedPlan]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updatedPlan]),
        }),
      }),
    }),
  };
}

// ── createPlan ────────────────────────────────────────────────────────────────

describe('DbTaskTracker.createPlan', () => {
  it('creates plan with version 1 when no prior plan exists', async () => {
    const db = makeDb({ existingPlanForLatest: null });
    const tracker = new DbTaskTracker(db as never);

    await tracker.createPlan('job-1', BASE_DRAFT);

    const insertValues = db.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1, jobId: 'job-1' }),
    );
  });

  it('creates plan with version = latest + 1', async () => {
    const db = makeDb({ existingPlanForLatest: makePlanRow({ version: 3 }) });
    const tracker = new DbTaskTracker(db as never);

    await tracker.createPlan('job-1', BASE_DRAFT);

    const insertValues = db.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4 }),
    );
  });

  it('sets status=needs_answers when openQuestions are non-empty', async () => {
    const db = makeDb({ existingPlanForLatest: null });
    const tracker = new DbTaskTracker(db as never);

    await tracker.createPlan('job-1', {
      ...BASE_DRAFT,
      openQuestions: [{ id: 'q1', question: 'Which approach?' }],
    });

    const insertValues = db.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'needs_answers' }),
    );
  });

  it('sets status=ready when no openQuestions', async () => {
    const db = makeDb({ existingPlanForLatest: null });
    const tracker = new DbTaskTracker(db as never);

    await tracker.createPlan('job-1', { ...BASE_DRAFT, openQuestions: [] });

    const insertValues = db.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it('sets contentUri to plans/{jobId}/v{version}', async () => {
    const db = makeDb({ existingPlanForLatest: null });
    const tracker = new DbTaskTracker(db as never);

    await tracker.createPlan('job-abc', BASE_DRAFT);

    const insertValues = db.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ contentUri: 'plans/job-abc/v1' }),
    );
  });

  it('stores draft fields in the data JSON', async () => {
    const db = makeDb({ existingPlanForLatest: null });
    const tracker = new DbTaskTracker(db as never);

    await tracker.createPlan('job-1', BASE_DRAFT);

    const insertValues = db.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: BASE_DRAFT.title,
          summary: BASE_DRAFT.summary,
          bodyMarkdown: BASE_DRAFT.bodyMarkdown,
        }),
      }),
    );
  });
});

// ── approvePlan ───────────────────────────────────────────────────────────────

describe('DbTaskTracker.approvePlan', () => {
  it('updates status to approved and sets approvedAt', async () => {
    const db = makeDb({ updateReturning: makePlanRow({ status: 'approved', approvedAt: new Date() }) });
    const tracker = new DbTaskTracker(db as never);

    const result = await tracker.approvePlan('plan-1');

    const setCall = db.update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', approvedAt: expect.any(Date) }),
    );
    expect(result.status).toBe('approved');
  });

  it('throws when plan not found (empty returning)', async () => {
    const db = makeDb();
    db.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const tracker = new DbTaskTracker(db as never);
    await expect(tracker.approvePlan('nonexistent')).rejects.toThrow('plan nonexistent not found');
  });
});

// ── rejectPlan ────────────────────────────────────────────────────────────────

describe('DbTaskTracker.rejectPlan', () => {
  it('sets status=rejected without feedback when no reason', async () => {
    const db = makeDb({ updateReturning: makePlanRow({ status: 'rejected', feedbackFromUser: null }) });
    const tracker = new DbTaskTracker(db as never);

    await tracker.rejectPlan('plan-1');

    const setCall = db.update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', feedbackFromUser: null }),
    );
  });

  it('stores reason as JSON when reason provided', async () => {
    const db = makeDb();
    const tracker = new DbTaskTracker(db as never);

    await tracker.rejectPlan('plan-1', 'Too risky');

    const setCall = db.update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackFromUser: JSON.stringify({ reason: 'Too risky' }),
      }),
    );
  });

  it('throws when plan not found', async () => {
    const db = makeDb();
    db.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const tracker = new DbTaskTracker(db as never);
    await expect(tracker.rejectPlan('gone')).rejects.toThrow('plan gone not found');
  });
});

// ── recordRevisionRequest ─────────────────────────────────────────────────────

describe('DbTaskTracker.recordRevisionRequest', () => {
  it('sets status=rejected and stores feedback as JSON', async () => {
    const db = makeDb();
    const tracker = new DbTaskTracker(db as never);

    await tracker.recordRevisionRequest('plan-1', {
      answers: { q1: 'Use factory pattern' },
      additionalFeedback: 'Please simplify',
    });

    const setCall = db.update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        feedbackFromUser: JSON.stringify({
          answers: { q1: 'Use factory pattern' },
          additionalFeedback: 'Please simplify',
        }),
      }),
    );
  });
});

// ── updatePlanStatus ──────────────────────────────────────────────────────────

describe('DbTaskTracker.updatePlanStatus', () => {
  it('updates only the status field', async () => {
    const db = makeDb();
    // updatePlanStatus uses update without returning
    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    db.update = vi.fn().mockReturnValue({ set: setMock });

    const tracker = new DbTaskTracker(db as never);
    await tracker.updatePlanStatus('plan-1', 'approved');

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
    );
  });
});
