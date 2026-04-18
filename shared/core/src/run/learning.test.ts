import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLearningPass } from './learning';
import { createMockMemoryBackend, createMockFetch } from '../__tests__/mocks';
import { InvalidMemoryFormatError, MemoryTooLargeError } from '@shared/memory';
import { StorageNotConfiguredError } from '@shared/storage';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SANDBOX_INFO = {
  id: 'sandbox-1',
  providerId: 'local',
  endpoint: 'http://localhost:8787',
  createdAt: new Date(),
  workspacePath: '/tmp/ws',
};

function makeJob(overrides: Partial<{
  id: string;
  githubUrl: string;
  title: string;
}> = {}) {
  return {
    id: overrides.id ?? 'aabbccdd-1234-5678-abcd-ef0123456789',
    githubUrl: overrides.githubUrl ?? 'https://github.com/owner/repo',
    title: overrides.title ?? 'Fix the login bug',
    description: null,
  };
}

function makeDb(job: ReturnType<typeof makeJob> | null = makeJob()) {
  const tx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ seq: 1 }]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  };
  return {
    query: {
      jobs: { findFirst: vi.fn().mockResolvedValue(job) },
      jobSteps: { findMany: vi.fn().mockResolvedValue([]) },
      plans: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    _tx: tx,
  };
}

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * Build a fake SSE body for the /prompt endpoint with a single result message.
 */
function makeSseBody(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// normalizeRepoKey('https://github.com/owner/repo') → 'github.com/owner/repo'
const REPO_KEY = 'github.com/owner/repo';

const VALID_MEMORY = `# Repository Memory: ${REPO_KEY}

Last updated: 2026-01-01
Total entries: 1

## Conventions

- [high] Use dependency injection everywhere. (job:aabbccdd)

## Architecture

## Tech debt

## Decisions
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runLearningPass', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    log = makeLog();
  });

  it('returns zeroCost and logs warn when job not found', async () => {
    const db = makeDb(null);
    const result = await runLearningPass('missing-job', SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
    });
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(log.warn).toHaveBeenCalled();
  });

  it('returns zeroCost and logs warn when githubUrl cannot be normalized', async () => {
    const job = makeJob({ githubUrl: 'not-a-valid-url' });
    const db = makeDb(job);
    const result = await runLearningPass(job.id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
    });
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id }),
      expect.stringContaining('normalize repo key'),
    );
  });

  it('returns zeroCost and logs warn when LLM call fails', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend();
    const fetchFn = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      fetchFn,
    });
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(log.warn).toHaveBeenCalledWith(
      expect.anything(),
      'learning pass: LLM call failed; keeping previous memory',
    );
  });

  it('returns zeroCost and logs warn when sandbox responds with non-200', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend();
    const fetchFn = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));
    const result = await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      fetchFn,
    });
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(log.warn).toHaveBeenCalled();
  });

  it('returns cost and logs warn when response is empty string', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend();
    const resultEvent = {
      type: 'result',
      subtype: 'success',
      result: '',
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.002,
    };
    const body = makeSseBody(resultEvent);
    const fetchFn = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const result = await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      fetchFn,
    });
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(log.warn).toHaveBeenCalledWith(
      expect.anything(),
      'learning pass: empty response; keeping previous memory',
    );
  });

  it('saves valid memory and returns correct cost', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend({
      saveResult: { sizeBytes: 512, entryCount: 3 },
    });
    const resultEvent = {
      type: 'result',
      subtype: 'success',
      result: VALID_MEMORY,
      usage: { input_tokens: 500, output_tokens: 200 },
      total_cost_usd: 0.01,
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(makeSseBody(resultEvent), { status: 200 }));

    const result = await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      fetchFn,
    });

    // runLearningPass trims the response before saving
    expect(memoryBackend.save).toHaveBeenCalledWith(REPO_KEY, VALID_MEMORY.trim());
    expect(result).toEqual({ inputTokens: 500, outputTokens: 200, costUsd: 0.01 });
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoKey: REPO_KEY }),
      'memory file updated',
    );
  });

  it('logs warn and saves rejected artifact on InvalidMemoryFormatError', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend();
    memoryBackend.save.mockRejectedValue(
      new InvalidMemoryFormatError(['missing section "## Conventions"']),
    );
    const storagePut = vi.fn().mockResolvedValue(undefined);
    const resultEvent = {
      type: 'result',
      subtype: 'success',
      result: 'bad memory content',
      usage: { input_tokens: 10, output_tokens: 5 },
      total_cost_usd: 0.001,
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(makeSseBody(resultEvent), { status: 200 }));

    const result = await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      storagePut,
      fetchFn,
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.anything(),
      'learning pass: returned unusable memory; keeping previous',
    );
    expect(storagePut).toHaveBeenCalledWith(
      expect.stringContaining('learning-rejected.md'),
      'bad memory content',
      'text/markdown',
    );
    // Still returns cost (not zeroCost)
    expect(result.inputTokens).toBe(10);
  });

  it('logs warn and saves rejected artifact on MemoryTooLargeError', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend();
    memoryBackend.save.mockRejectedValue(new MemoryTooLargeError(40000, 32768));
    const storagePut = vi.fn().mockResolvedValue(undefined);
    const resultEvent = {
      type: 'result',
      subtype: 'success',
      result: 'way too large content',
      usage: { input_tokens: 10, output_tokens: 5 },
      total_cost_usd: 0.001,
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(makeSseBody(resultEvent), { status: 200 }));

    await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      storagePut,
      fetchFn,
    });

    expect(storagePut).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.anything(),
      'learning pass: returned unusable memory; keeping previous',
    );
  });

  it('logs warn and continues when StorageNotConfiguredError on save', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend();
    memoryBackend.save.mockRejectedValue(new StorageNotConfiguredError());
    const resultEvent = {
      type: 'result',
      subtype: 'success',
      result: VALID_MEMORY,
      usage: { input_tokens: 10, output_tokens: 5 },
      total_cost_usd: 0.001,
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(makeSseBody(resultEvent), { status: 200 }));

    const result = await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      fetchFn,
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.anything(),
      'learning pass: storage not configured; skipping memory save',
    );
    // Still returns the cost (not zeroCost)
    expect(result.inputTokens).toBe(10);
  });

  it('logs warn when agent emits an error event', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend();
    const errorEvent = { type: 'error', error: 'tool_use_failed' };
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(makeSseBody(errorEvent), { status: 200 }),
    );

    const result = await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      fetchFn,
    });
    // LLM error is caught → zeroCost + warn
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(log.warn).toHaveBeenCalledWith(
      expect.anything(),
      'learning pass: LLM call failed; keeping previous memory',
    );
  });

  it('uses EMPTY_MEMORY_TEMPLATE when no prior memory exists', async () => {
    const db = makeDb();
    const memoryBackend = createMockMemoryBackend({ context: null }); // no prior memory
    const resultEvent = {
      type: 'result',
      subtype: 'success',
      result: VALID_MEMORY,
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.005,
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(makeSseBody(resultEvent), { status: 200 }));

    await runLearningPass(makeJob().id, SANDBOX_INFO, '/ws', {
      db: db as never,
      log: log as never,
      memoryBackend,
      fetchFn,
    });

    // The fetch body should contain the empty template header
    const fetchBody = JSON.parse((fetchFn.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(fetchBody.description).toContain('Repository Memory:');
  });
});
