import { describe, it, expect, vi } from 'vitest';
import { SessionsService } from './sessions.service';
import { createMockBoss, createMockLog, createMockTaskIngestService } from '../__tests__/mocks';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<{
  id: string;
  defaultGithubUrl: string | null;
  defaultWorkflowId: string | null;
  model: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'conv-1',
    title: 'My Session',
    defaultGithubUrl: overrides.defaultGithubUrl ?? null,
    defaultWorkflowId: overrides.defaultWorkflowId ?? null,
    planHoldHours: 24,
    model: overrides.model ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeMessage(overrides: Partial<{ id: string; jobId: string | null }> = {}) {
  return {
    id: overrides.id ?? 'msg-1',
    sessionId: 'conv-1',
    role: 'user' as const,
    content: 'Hello',
    jobId: overrides.jobId ?? null,
    prArtifactUrl: null,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

function makeRepo(options: {
  session?: ReturnType<typeof makeSession> | null;
  message?: ReturnType<typeof makeMessage>;
  lastCompletedJobId?: string | null;
} = {}) {
  return {
    findById: vi.fn().mockResolvedValue(options.session !== undefined ? options.session : makeSession()),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(makeSession()),
    update: vi.fn().mockResolvedValue(makeSession()),
    delete: vi.fn().mockResolvedValue(undefined),
    findMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    insertMessage: vi.fn().mockResolvedValue(options.message ?? makeMessage()),
    updateMessageJobId: vi.fn().mockResolvedValue(undefined),
    findLastCompletedJobId: vi.fn().mockResolvedValue(options.lastCompletedJobId ?? null),
  };
}

function makeDb(workflowVersionId?: string) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(workflowVersionId ? [{ id: workflowVersionId }] : []),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionsService.send', () => {
  it('throws NOT_FOUND when session does not exist', async () => {
    const repo = makeRepo({ session: null });
    const svc = new SessionsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });
    await expect(
      svc.send({ sessionId: 'missing', message: 'hi' }),
    ).rejects.toThrow('session not found');
  });

  it('throws BAD_REQUEST when no githubUrl available', async () => {
    const repo = makeRepo({ session: makeSession({ defaultGithubUrl: null }) });
    const svc = new SessionsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });
    await expect(
      svc.send({ sessionId: 'conv-1', message: 'Fix bug' }),
    ).rejects.toThrow('no githubUrl provided');
  });

  it('uses override githubUrl over session default', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ session: makeSession({ defaultGithubUrl: 'https://github.com/default/repo' }) });
    const svc = new SessionsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.send({
      sessionId: 'conv-1',
      message: 'Fix bug',
      githubUrl: 'https://github.com/override/repo',
    });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ githubUrl: 'https://github.com/override/repo' }),
    );
  });

  it('falls back to session defaultGithubUrl', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ session: makeSession({ defaultGithubUrl: 'https://github.com/conv/repo' }) });
    const svc = new SessionsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.send({ sessionId: 'conv-1', message: 'Fix bug' });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ githubUrl: 'https://github.com/conv/repo' }),
    );
  });

  it('includes parentJobId when previous completed job exists', async () => {
    const ingest = createMockTaskIngestService('job-new');
    const repo = makeRepo({
      session: makeSession({ defaultGithubUrl: 'https://github.com/owner/repo' }),
      lastCompletedJobId: 'job-parent',
    });
    const svc = new SessionsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.send({ sessionId: 'conv-1', message: 'Continue work' });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ parentJobId: 'job-parent' }),
    );
  });

  it('resolves workflowVersionId from session defaultWorkflowId', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({
      session: makeSession({ defaultGithubUrl: 'https://github.com/owner/repo', defaultWorkflowId: 'wf-1' }),
    });
    const db = makeDb('wv-latest');
    const svc = new SessionsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.send({ sessionId: 'conv-1', message: 'Fix bug' });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ workflowVersionId: 'wv-latest' }),
    );
  });

  it('uses explicit workflowId override, resolving its latest version', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ session: makeSession({ defaultGithubUrl: 'https://github.com/owner/repo', defaultWorkflowId: 'wf-default' }) });
    const db = makeDb('wv-override');
    const svc = new SessionsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.send({
      sessionId: 'conv-1',
      message: 'Fix bug',
      workflowId: 'wf-override',
    });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ workflowVersionId: 'wv-override' }),
    );
  });

  it('backfills message.jobId and returns jobId', async () => {
    const ingest = createMockTaskIngestService('job-backfill');
    const repo = makeRepo({
      session: makeSession({ defaultGithubUrl: 'https://github.com/owner/repo' }),
      message: makeMessage({ id: 'msg-123' }),
    });
    const svc = new SessionsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    const result = await svc.send({ sessionId: 'conv-1', message: 'Fix bug' });

    expect(repo.updateMessageJobId).toHaveBeenCalledWith('msg-123', 'job-backfill');
    expect(result).toEqual({ jobId: 'job-backfill' });
  });

  it('passes autoApprove to ingest', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ session: makeSession({ defaultGithubUrl: 'https://github.com/owner/repo' }) });
    const svc = new SessionsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.send({ sessionId: 'conv-1', message: 'Fix bug', autoApprove: true });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ autoApprove: true }),
    );
  });

  it('passes session model to ingest', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({
      session: makeSession({ defaultGithubUrl: 'https://github.com/owner/repo', model: 'claude-opus-4-6' }),
    });
    const svc = new SessionsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.send({ sessionId: 'conv-1', message: 'Fix bug' });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-6' }),
    );
  });
});
