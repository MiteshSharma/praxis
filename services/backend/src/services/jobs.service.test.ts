import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobsService } from './jobs.service';
import { createMockBoss, createMockLog, createMockJobsRepository, createMockTaskIngestService } from '../__tests__/mocks';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJobRow(overrides: Partial<{
  id: string;
  status: string;
  conversationId: string | null;
  workflowVersionId: string | null;
  title: string;
  description: string | null;
  githubUrl: string;
  githubBranch: string;
}> = {}) {
  return {
    id: overrides.id ?? 'job-1',
    status: overrides.status ?? 'failed',
    conversationId: overrides.conversationId ?? null,
    workflowVersionId: overrides.workflowVersionId ?? null,
    title: overrides.title ?? 'Fix auth',
    description: overrides.description ?? null,
    githubUrl: overrides.githubUrl ?? 'https://github.com/owner/repo',
    githubBranch: overrides.githubBranch ?? 'main',
    source: 'web',
    externalId: null,
    externalUrl: null,
    triggerKind: 'user_prompt',
    githubCommitSha: null,
    errorMessage: null,
    errorCategory: null,
    autoApprove: false,
    model: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalCostUsd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
}

function makeDb(options: {
  job?: ReturnType<typeof makeJobRow> | null;
  plan?: { id: string; status: string } | null;
} = {}) {
  return {
    query: {
      jobs: { findFirst: vi.fn().mockResolvedValue(options.job ?? makeJobRow()) },
      plans: { findFirst: vi.fn().mockResolvedValue(options.plan ?? null) },
    },
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobsService.create', () => {
  it('parses input and delegates to ingest', async () => {
    const ingest = createMockTaskIngestService('new-job');
    const repo = createMockJobsRepository();
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      ingest: ingest as never,
      repo: repo as never,
    });

    const result = await svc.create({
      githubUrl: 'https://github.com/owner/repo',
      githubBranch: 'main',
      input: 'Fix the login bug\n\nUsers cannot log in on mobile.',
    });

    expect(result).toEqual({ jobId: 'new-job' });
    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUrl: 'https://github.com/owner/repo',
        source: 'web',
      }),
    );
  });
});

describe('JobsService.getById', () => {
  it('returns DTO when job found', async () => {
    const repo = createMockJobsRepository({ findById: makeJobRow({ id: 'job-found' }) as never });
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });

    const result = await svc.getById('job-found');
    expect(result.id).toBe('job-found');
  });

  it('throws NOT_FOUND when job missing', async () => {
    const repo = createMockJobsRepository({ findById: undefined as never });
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });

    await expect(svc.getById('missing')).rejects.toThrow('job not found');
  });
});

describe('JobsService.resumeFromPlan', () => {
  it('throws NOT_FOUND when job missing', async () => {
    const repo = createMockJobsRepository({ findById: undefined as never });
    const db = makeDb({ job: null });
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });
    await expect(svc.resumeFromPlan('missing')).rejects.toThrow('job not found');
  });

  it('throws BAD_REQUEST when job status is not failed', async () => {
    const repo = createMockJobsRepository({ findById: makeJobRow({ status: 'executing' }) as never });
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });
    await expect(svc.resumeFromPlan('job-1')).rejects.toThrow('only failed jobs can be resumed');
  });

  it('throws BAD_REQUEST when no approved plan exists', async () => {
    const repo = createMockJobsRepository({ findById: makeJobRow({ status: 'failed' }) as never });
    const db = makeDb({ plan: null });
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });
    await expect(svc.resumeFromPlan('job-1')).rejects.toThrow('no approved plan found');
  });

  it('sets job status=queued and enqueues when approved plan exists', async () => {
    const boss = createMockBoss();
    const repo = createMockJobsRepository({ findById: makeJobRow({ id: 'job-1', status: 'failed' }) as never });
    const db = makeDb({ plan: { id: 'plan-1', status: 'approved' } });
    const svc = new JobsService(db as never, boss as never, createMockLog() as never, {
      repo: repo as never,
    });

    const result = await svc.resumeFromPlan('job-1');
    expect(result).toEqual({ jobId: 'job-1' });
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
    expect(boss.send).toHaveBeenCalledWith(expect.any(String), { jobId: 'job-1' });
  });
});

describe('JobsService.restart', () => {
  it('throws NOT_FOUND when original job missing', async () => {
    const repo = createMockJobsRepository({ findById: undefined as never });
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });
    await expect(svc.restart('missing')).rejects.toThrow('job not found');
  });

  it('ingests new job with restartedFromJobId in metadata', async () => {
    const ingest = createMockTaskIngestService('restarted-job');
    const repo = createMockJobsRepository({ findById: makeJobRow({ id: 'orig-job' }) as never });
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      ingest: ingest as never,
      repo: repo as never,
    });

    const result = await svc.restart('orig-job');
    expect(result).toEqual({ jobId: 'restarted-job' });
    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ restartedFromJobId: 'orig-job' }),
        triggerKind: 'restart',
      }),
    );
  });

  it('re-points conversation messages to new job when conversationId set', async () => {
    const ingest = createMockTaskIngestService('new-job');
    const repo = createMockJobsRepository({
      findById: makeJobRow({ id: 'orig', conversationId: 'conv-1' }) as never,
    });
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      ingest: ingest as never,
      repo: repo as never,
    });

    await svc.restart('orig');

    // Should call db.update to re-point messages
    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'new-job' }));
  });

  it('does not update messages when no conversationId', async () => {
    const ingest = createMockTaskIngestService('new-job');
    const repo = createMockJobsRepository({
      findById: makeJobRow({ id: 'orig', conversationId: null }) as never,
    });
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      ingest: ingest as never,
      repo: repo as never,
    });

    await svc.restart('orig');
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('JobsService.list', () => {
  it('delegates to repo.findMany with limit', async () => {
    const repo = createMockJobsRepository({ findMany: [] });
    const db = makeDb();
    const svc = new JobsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });

    await svc.list(25);
    expect(repo.findMany).toHaveBeenCalledWith(25);
  });
});
