import { describe, it, expect, vi } from 'vitest';
import { appendTimeline, transitionJob } from './transitions';

// ── DB mock helpers ───────────────────────────────────────────────────────────

function makeTx(options: {
  updateReturning?: unknown[];
  selectSeq?: number;
} = {}) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ seq: options.selectSeq ?? 1 }]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(options.updateReturning ?? []),
        }),
      }),
    }),
  };
}

function makeDb(txOptions?: Parameters<typeof makeTx>[0]) {
  const tx = makeTx(txOptions);
  const db = {
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
  return db;
}

// ── appendTimeline ────────────────────────────────────────────────────────────

describe('appendTimeline', () => {
  it('returns the seq from the SELECT', async () => {
    const db = makeDb({ selectSeq: 5 });
    const seq = await appendTimeline(db as never, 'job-1', 'my-event', { foo: 'bar' });
    expect(seq).toBe(5);
  });

  it('inserts a timeline row with correct fields', async () => {
    const db = makeDb({ selectSeq: 3 });
    await appendTimeline(db as never, 'job-xyz', 'plan-approved', { planId: 'p-1' });

    const tx = db._tx;
    expect(tx.insert).toHaveBeenCalled();
    const valuesCall = tx.insert.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-xyz',
        type: 'plan-approved',
        payload: { planId: 'p-1' },
      }),
    );
  });

  it('runs inside a transaction', async () => {
    const db = makeDb();
    await appendTimeline(db as never, 'job-1', 'event', {});
    expect(db.transaction).toHaveBeenCalledOnce();
  });
});

// ── transitionJob ─────────────────────────────────────────────────────────────

describe('transitionJob', () => {
  it('returns transition result when CAS succeeds', async () => {
    const updatedRow = { id: 'job-1', status: 'executing' };
    const db = makeDb({ updateReturning: [updatedRow], selectSeq: 4 });

    const result = await transitionJob(db as never, 'job-1', 'preparing', 'executing');
    expect(result).toEqual({ from: 'preparing', to: 'executing', seq: 4 });
  });

  it('returns null when CAS fails (job in wrong status)', async () => {
    const db = makeDb({ updateReturning: [], selectSeq: 1 }); // no rows updated
    const result = await transitionJob(db as never, 'job-1', 'preparing', 'executing');
    expect(result).toBeNull();
  });

  it('runs inside a transaction', async () => {
    const db = makeDb({ updateReturning: [{ id: 'job-1' }], selectSeq: 1 });
    await transitionJob(db as never, 'job-1', 'queued', 'provisioning');
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('appends status-changed timeline event on success', async () => {
    const db = makeDb({ updateReturning: [{ id: 'job-1' }], selectSeq: 2 });
    await transitionJob(db as never, 'job-1', 'queued', 'provisioning');

    const tx = db._tx;
    const insertValuesCall = tx.insert.mock.results[0]?.value?.values;
    expect(insertValuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status-changed',
        payload: { from: 'queued', to: 'provisioning' },
      }),
    );
  });

  it('does NOT append timeline when CAS fails', async () => {
    const db = makeDb({ updateReturning: [] });
    await transitionJob(db as never, 'job-1', 'preparing', 'executing');
    // No insert should happen
    expect(db._tx.insert).not.toHaveBeenCalled();
  });

  it('includes patch fields in the update', async () => {
    const db = makeDb({ updateReturning: [{ id: 'job-1' }], selectSeq: 1 });
    const startedAt = new Date();
    await transitionJob(db as never, 'job-1', 'queued', 'provisioning', { startedAt });

    const tx = db._tx;
    const setCall = tx.update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ startedAt, status: 'provisioning' }));
  });
});
