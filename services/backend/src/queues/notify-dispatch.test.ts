import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerNotifyDispatch } from './notify-dispatch';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeNotifier() {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

function makeRegistry(notifier: ReturnType<typeof makeNotifier> | null = makeNotifier()) {
  return {
    resolveForJob: vi.fn().mockReturnValue(notifier),
  };
}

function makeDb(jobRow: unknown = { id: 'job-1', source: 'web' }) {
  return {
    query: {
      jobs: { findFirst: vi.fn().mockResolvedValue(jobRow) },
    },
  };
}

/**
 * Build a fake pg-boss that captures the worker callback so we can invoke it.
 */
function makeBoss() {
  let workerFn: ((batch: unknown[]) => Promise<void>) | null = null;

  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockImplementation(
      (_queue: string, _opts: unknown, fn: (batch: unknown[]) => Promise<void>) => {
        workerFn = fn;
        return Promise.resolve();
      },
    ),
    on: vi.fn(),
    /** Call the captured worker with a batch */
    async runWorker(batch: unknown[]) {
      if (!workerFn) throw new Error('worker not registered');
      await workerFn(batch);
    },
  };
}

function makePgJob(jobId: string, eventKind = 'job.status_changed') {
  return {
    data: {
      jobId,
      seq: 1,
      event: { kind: eventKind, status: 'executing' },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerNotifyDispatch', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    log = makeLog();
  });

  it('registers a worker on the notify-dispatch queue', async () => {
    const boss = makeBoss();
    await registerNotifyDispatch(boss as never, {
      db: makeDb() as never,
      registry: makeRegistry() as never,
      log: log as never,
    });
    expect(boss.work).toHaveBeenCalledWith(
      'notify/dispatch',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('logs warn and continues (no throw) when job row is missing', async () => {
    const boss = makeBoss();
    const db = makeDb(null); // job not found

    await registerNotifyDispatch(boss as never, {
      db: db as never,
      registry: makeRegistry() as never,
      log: log as never,
    });

    // Should not throw
    await boss.runWorker([makePgJob('missing-job')]);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'missing-job' }),
      expect.stringContaining('missing'),
    );
  });

  it('calls notifier.notify with event, jobId, and seq', async () => {
    const notifier = makeNotifier();
    const registry = makeRegistry(notifier);
    const boss = makeBoss();
    const db = makeDb({ id: 'job-1', source: 'web' });

    await registerNotifyDispatch(boss as never, {
      db: db as never,
      registry: registry as never,
      log: log as never,
    });

    await boss.runWorker([makePgJob('job-1', 'job.status_changed')]);

    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job.status_changed' }),
      expect.objectContaining({ jobId: 'job-1', seq: 1 }),
    );
  });

  it('re-throws notifier errors for pg-boss retry', async () => {
    const notifier = makeNotifier();
    notifier.notify.mockRejectedValue(new Error('network timeout'));
    const boss = makeBoss();
    const db = makeDb({ id: 'job-1', source: 'web' });

    await registerNotifyDispatch(boss as never, {
      db: db as never,
      registry: makeRegistry(notifier) as never,
      log: log as never,
    });

    await expect(boss.runWorker([makePgJob('job-1')])).rejects.toThrow('network timeout');
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      expect.stringContaining('retry'),
    );
  });

  it('handles multiple jobs in a batch, continuing past missing jobs', async () => {
    const notifier = makeNotifier();
    const db = makeDb();
    // First call returns null (missing), second returns a row
    db.query.jobs.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'job-2', source: 'web' });

    const boss = makeBoss();
    await registerNotifyDispatch(boss as never, {
      db: db as never,
      registry: makeRegistry(notifier) as never,
      log: log as never,
    });

    await boss.runWorker([makePgJob('job-missing'), makePgJob('job-2')]);

    // Notifier only called for job-2
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
