import { describe, it, expect, vi } from 'vitest';
import { emitNotification, NOTIFY_DISPATCH_QUEUE } from './notify';
import type { NotifyEvent } from '@shared/contracts';

function makeBoss() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

describe('emitNotification', () => {
  it('sends to NOTIFY_DISPATCH_QUEUE', async () => {
    const boss = makeBoss();
    const event: NotifyEvent = { kind: 'status', status: 'executing' };
    await emitNotification(boss as never, 'job-1', 3, event);
    expect(boss.send).toHaveBeenCalledWith(NOTIFY_DISPATCH_QUEUE, expect.any(Object));
  });

  it('payload contains jobId, seq, event, and emittedAt', async () => {
    const boss = makeBoss();
    const before = Date.now();
    const event: NotifyEvent = { kind: 'status', status: 'completed' };
    await emitNotification(boss as never, 'job-42', 7, event);
    const after = Date.now();

    const [, payload] = boss.send.mock.calls[0] as [string, { jobId: string; seq: number; emittedAt: string; event: NotifyEvent }];
    expect(payload.jobId).toBe('job-42');
    expect(payload.seq).toBe(7);
    expect(payload.event).toEqual(event);
    const emittedAt = new Date(payload.emittedAt).getTime();
    expect(emittedAt).toBeGreaterThanOrEqual(before);
    expect(emittedAt).toBeLessThanOrEqual(after);
  });

  it('forwards different event kinds unchanged', async () => {
    const boss = makeBoss();
    const chunkEvent: NotifyEvent = { kind: 'chunk', raw: 'some output', seq: 1 };
    await emitNotification(boss as never, 'job-1', 1, chunkEvent);
    const [, payload] = boss.send.mock.calls[0] as [string, { event: NotifyEvent }];
    expect(payload.event).toEqual(chunkEvent);
  });

  it('NOTIFY_DISPATCH_QUEUE is a non-empty string', () => {
    expect(typeof NOTIFY_DISPATCH_QUEUE).toBe('string');
    expect(NOTIFY_DISPATCH_QUEUE.length).toBeGreaterThan(0);
  });
});
