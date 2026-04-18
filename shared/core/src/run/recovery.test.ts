import { describe, it, expect, vi } from 'vitest';
import { recoverStuckJobs } from './recovery';

// ── DB mock ───────────────────────────────────────────────────────────────────

function makeStuckJob(overrides: {
  id?: string;
  status?: string;
  retryCount?: number;
  maxRetries?: number;
} = {}) {
  return {
    id: overrides.id ?? 'job-stuck',
    status: overrides.status ?? 'executing',
    retryCount: overrides.retryCount ?? 0,
    maxRetries: overrides.maxRetries ?? 3,
  };
}

function makeTx(seq = 1) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ seq }]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeDb(stuckJobs: ReturnType<typeof makeStuckJob>[]) {
  const tx = makeTx();
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(stuckJobs),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    // update().set().where() resolves to undefined (no returning needed)
    _where: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

// Override the .where() for the update chain vs select chain
function makeDbWithUpdateWhere(stuckJobs: ReturnType<typeof makeStuckJob>[]) {
  const tx = makeTx();
  let isSelectChain = true;

  const db: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockImplementation(() => {
      isSelectChain = true;
      return db;
    }),
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockImplementation(() => {
      isSelectChain = false;
      return db;
    }),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => {
      if (isSelectChain) return Promise.resolve(stuckJobs);
      return Promise.resolve(undefined);
    }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    _tx: tx as unknown as ReturnType<typeof vi.fn>,
  };
  return db;
}

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('recoverStuckJobs', () => {
  it('returns 0 when no stuck jobs', async () => {
    const db = makeDbWithUpdateWhere([]);
    const log = makeLog();
    const count = await recoverStuckJobs(db as never, log as never);
    expect(count).toBe(0);
  });

  it('re-queues job when retryCount < maxRetries', async () => {
    const job = makeStuckJob({ id: 'job-1', retryCount: 1, maxRetries: 3 });
    const db = makeDbWithUpdateWhere([job]);
    const log = makeLog();

    const count = await recoverStuckJobs(db as never, log as never);
    expect(count).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      'recovered stuck job to queued',
    );
  });

  it('fails job when retryCount >= maxRetries', async () => {
    const job = makeStuckJob({ id: 'job-2', retryCount: 3, maxRetries: 3 });
    const db = makeDbWithUpdateWhere([job]);
    const log = makeLog();

    const count = await recoverStuckJobs(db as never, log as never);
    expect(count).toBe(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-2' }),
      'stuck job exceeded max retries',
    );
  });

  it('processes multiple stuck jobs and returns total count', async () => {
    const jobs = [
      makeStuckJob({ id: 'j1', retryCount: 0, maxRetries: 3 }),
      makeStuckJob({ id: 'j2', retryCount: 3, maxRetries: 3 }),
      makeStuckJob({ id: 'j3', retryCount: 1, maxRetries: 2 }),
    ];
    const db = makeDbWithUpdateWhere(jobs);
    const log = makeLog();

    const count = await recoverStuckJobs(db as never, log as never);
    expect(count).toBe(3);
  });

  it('re-queues with incremented retryCount', async () => {
    const job = makeStuckJob({ id: 'job-retry', retryCount: 2, maxRetries: 5 });
    const db = makeDbWithUpdateWhere([job]);
    const log = makeLog();

    await recoverStuckJobs(db as never, log as never);

    // The update should set retryCount: 3 (2+1)
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued', retryCount: 3 }),
    );
  });

  it('marks failed job with errorMessage and errorCategory', async () => {
    const job = makeStuckJob({ id: 'job-fail', retryCount: 5, maxRetries: 5 });
    const db = makeDbWithUpdateWhere([job]);
    const log = makeLog();

    await recoverStuckJobs(db as never, log as never);

    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'stuck job exceeded max retries',
        errorCategory: 'permanent',
      }),
    );
  });
});
