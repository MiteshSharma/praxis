import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskIngestService } from './task-ingest-service';
import type { NormalizedTask } from './task-source';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_TASK: NormalizedTask = {
  source: 'web',
  triggerKind: 'user_prompt',
  title: 'Add login feature',
  description: 'Implement OAuth2 with GitHub',
  metadata: {},
  githubUrl: 'https://github.com/owner/repo',
  githubBranch: 'main',
};

function makeInsertedJob(id = 'new-job-id') {
  return { id, status: 'queued', title: 'Add login feature' };
}

function makeTx(jobRow = makeInsertedJob()) {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([jobRow]),
      }),
    }),
  };
}

function makeDb(options: {
  existingJob?: { id: string } | null;
  insertedJob?: ReturnType<typeof makeInsertedJob>;
} = {}) {
  const tx = makeTx(options.insertedJob);
  return {
    query: {
      jobs: {
        findFirst: vi.fn().mockResolvedValue(options.existingJob ?? null),
      },
    },
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

function makeBoss() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TaskIngestService.ingest', () => {
  let boss: ReturnType<typeof makeBoss>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    boss = makeBoss();
    log = makeLog();
  });

  it('returns existing job when externalId matches (dedup)', async () => {
    const existing = { id: 'existing-job' };
    const db = makeDb({ existingJob: existing });
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    const result = await svc.ingest({ ...BASE_TASK, externalId: 'ext-123' });

    expect(result).toEqual({ id: 'existing-job', created: false });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('skips dedup check when no externalId provided', async () => {
    const db = makeDb();
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    await svc.ingest({ ...BASE_TASK, externalId: undefined });

    expect(db.query.jobs.findFirst).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalled();
  });

  it('inserts new job and returns created=true', async () => {
    const db = makeDb({ insertedJob: makeInsertedJob('brand-new-id') });
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    const result = await svc.ingest(BASE_TASK);

    expect(result).toEqual({ id: 'brand-new-id', created: true });
  });

  it('enqueues job to JOB_EXECUTE_QUEUE after insert', async () => {
    const db = makeDb({ insertedJob: makeInsertedJob('job-enqueue') });
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    await svc.ingest(BASE_TASK);

    expect(boss.send).toHaveBeenCalledWith(
      expect.any(String),
      { jobId: 'job-enqueue' },
    );
  });

  it('inserts job-created timeline row inside transaction', async () => {
    const db = makeDb();
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    await svc.ingest(BASE_TASK);

    const tx = db._tx;
    // insert is called twice: once for jobs, once for jobTimeline
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it('uses github branch from task (defaults to main)', async () => {
    const db = makeDb();
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    await svc.ingest({ ...BASE_TASK, githubBranch: 'feat/my-branch' });

    const insertValues = db._tx.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ githubBranch: 'feat/my-branch' }),
    );
  });

  it('defaults githubBranch to main when not provided', async () => {
    const db = makeDb();
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    const taskWithoutBranch = { ...BASE_TASK };
    delete (taskWithoutBranch as Partial<NormalizedTask>).githubBranch;

    await svc.ingest(taskWithoutBranch);

    const insertValues = db._tx.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ githubBranch: 'main' }),
    );
  });

  it('sets initial status to queued', async () => {
    const db = makeDb();
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    await svc.ingest(BASE_TASK);

    const insertValues = db._tx.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued' }),
    );
  });

  it('merges workflowInputs into metadata', async () => {
    const db = makeDb();
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    await svc.ingest({
      ...BASE_TASK,
      metadata: { existingKey: 'value' },
      workflowInputs: { myInput: 'hello' },
    });

    const insertValues = db._tx.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          existingKey: 'value',
          workflowInputs: { myInput: 'hello' },
        }),
      }),
    );
  });

  it('logs info after successful ingest', async () => {
    const db = makeDb({ insertedJob: makeInsertedJob('job-log') });
    const svc = new TaskIngestService(db as never, boss as never, log as never);

    await svc.ingest(BASE_TASK);

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-log' }),
      'job ingested and enqueued',
    );
  });
});
