import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationsService } from './conversations.service';
import { createMockBoss, createMockLog, createMockTaskIngestService } from '../__tests__/mocks';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConv(overrides: Partial<{
  id: string;
  defaultGithubUrl: string | null;
  defaultWorkflowId: string | null;
  model: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'conv-1',
    title: 'My Conversation',
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
    conversationId: 'conv-1',
    role: 'user' as const,
    content: 'Hello',
    jobId: overrides.jobId ?? null,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

function makeRepo(options: {
  conv?: ReturnType<typeof makeConv> | null;
  message?: ReturnType<typeof makeMessage>;
  lastCompletedJobId?: string | null;
} = {}) {
  return {
    findById: vi.fn().mockResolvedValue(options.conv !== undefined ? options.conv : makeConv()),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(makeConv()),
    update: vi.fn().mockResolvedValue(makeConv()),
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

describe('ConversationsService.sendMessage', () => {
  it('throws NOT_FOUND when conversation does not exist', async () => {
    const repo = makeRepo({ conv: null });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });
    await expect(
      svc.sendMessage({ conversationId: 'missing', content: 'hi', triggersJob: false }),
    ).rejects.toThrow('conversation not found');
  });

  it('inserts message and returns null jobId when triggersJob=false', async () => {
    const repo = makeRepo({ message: makeMessage({ id: 'msg-new' }) });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });

    const result = await svc.sendMessage({
      conversationId: 'conv-1',
      content: 'Just a message',
      triggersJob: false,
    });

    expect(result).toEqual({ messageId: 'msg-new', jobId: null });
    expect(repo.insertMessage).toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when triggersJob=true and no githubUrl available', async () => {
    const repo = makeRepo({ conv: makeConv({ defaultGithubUrl: null }) });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
    });

    await expect(
      svc.sendMessage({ conversationId: 'conv-1', content: 'Fix bug', triggersJob: true }),
    ).rejects.toThrow('no githubUrl provided');
  });

  it('uses override githubUrl over conversation default', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ conv: makeConv({ defaultGithubUrl: 'https://github.com/default/repo' }) });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.sendMessage({
      conversationId: 'conv-1',
      content: 'Fix bug',
      triggersJob: true,
      jobOverrides: { githubUrl: 'https://github.com/override/repo' },
    });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ githubUrl: 'https://github.com/override/repo' }),
    );
  });

  it('falls back to conversation defaultGithubUrl', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ conv: makeConv({ defaultGithubUrl: 'https://github.com/conv/repo' }) });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.sendMessage({ conversationId: 'conv-1', content: 'Fix bug', triggersJob: true });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ githubUrl: 'https://github.com/conv/repo' }),
    );
  });

  it('includes parentJobId when previous completed job exists', async () => {
    const ingest = createMockTaskIngestService('job-new');
    const repo = makeRepo({
      conv: makeConv({ defaultGithubUrl: 'https://github.com/owner/repo' }),
      lastCompletedJobId: 'job-parent',
    });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.sendMessage({ conversationId: 'conv-1', content: 'Continue work', triggersJob: true });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ parentJobId: 'job-parent' }),
    );
  });

  it('uses title override instead of parsing content', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ conv: makeConv({ defaultGithubUrl: 'https://github.com/owner/repo' }) });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.sendMessage({
      conversationId: 'conv-1',
      content: 'Message body with details',
      triggersJob: true,
      jobOverrides: { title: 'Custom Title' },
    });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Custom Title' }),
    );
  });

  it('resolves workflowVersionId from conversation defaultWorkflowId', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({
      conv: makeConv({ defaultGithubUrl: 'https://github.com/owner/repo', defaultWorkflowId: 'wf-1' }),
    });
    const db = makeDb('wv-latest');
    const svc = new ConversationsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.sendMessage({ conversationId: 'conv-1', content: 'Fix bug', triggersJob: true });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ workflowVersionId: 'wv-latest' }),
    );
  });

  it('uses explicit workflowVersionId override without querying DB', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ conv: makeConv({ defaultGithubUrl: 'https://github.com/owner/repo', defaultWorkflowId: 'wf-1' }) });
    const db = makeDb('wv-from-db');
    const svc = new ConversationsService(db as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.sendMessage({
      conversationId: 'conv-1',
      content: 'Fix bug',
      triggersJob: true,
      jobOverrides: { workflowVersionId: 'wv-override' },
    });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ workflowVersionId: 'wv-override' }),
    );
    // Should not query workflow_versions since override was provided
    expect(db.select).not.toHaveBeenCalled();
  });

  it('backfills message.jobId after successful ingestion', async () => {
    const ingest = createMockTaskIngestService('job-backfill');
    const repo = makeRepo({
      conv: makeConv({ defaultGithubUrl: 'https://github.com/owner/repo' }),
      message: makeMessage({ id: 'msg-123' }),
    });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    const result = await svc.sendMessage({
      conversationId: 'conv-1',
      content: 'Fix bug',
      triggersJob: true,
    });

    expect(repo.updateMessageJobId).toHaveBeenCalledWith('msg-123', 'job-backfill');
    expect(result).toEqual({ messageId: 'msg-123', jobId: 'job-backfill' });
  });

  it('passes autoApprove override to ingest', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({ conv: makeConv({ defaultGithubUrl: 'https://github.com/owner/repo' }) });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.sendMessage({
      conversationId: 'conv-1',
      content: 'Fix bug',
      triggersJob: true,
      jobOverrides: { autoApprove: true },
    });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ autoApprove: true }),
    );
  });

  it('passes conversation model override to ingest', async () => {
    const ingest = createMockTaskIngestService('job-1');
    const repo = makeRepo({
      conv: makeConv({ defaultGithubUrl: 'https://github.com/owner/repo', model: 'claude-opus-4-6' }),
    });
    const svc = new ConversationsService(makeDb() as never, createMockBoss() as never, createMockLog() as never, {
      repo: repo as never,
      ingest: ingest as never,
    });

    await svc.sendMessage({ conversationId: 'conv-1', content: 'Fix bug', triggersJob: true });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-6' }),
    );
  });
});
