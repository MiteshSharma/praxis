import { describe, it, expect, vi } from 'vitest';
import { dispatchEvent, dispatchToConversation } from './dispatch';
import type { PraxisChannel } from './types';
import type { PraxisEvent } from '@shared/contracts';
import type { PluginRegistry } from '../plugins/registry';

// ── dispatchEvent ─────────────────────────────────────────────────────────────

describe('dispatchEvent', () => {
  it('calls onPlanReady for plan.ready event', async () => {
    const channel: PraxisChannel = { onPlanReady: vi.fn().mockResolvedValue(undefined) };
    const event = { type: 'plan.ready' } as PraxisEvent;
    await dispatchEvent(channel, event);
    expect(channel.onPlanReady).toHaveBeenCalledWith(event);
  });

  it('calls onJobCompleted for job.completed event', async () => {
    const channel: PraxisChannel = { onJobCompleted: vi.fn().mockResolvedValue(undefined) };
    const event = { type: 'job.completed' } as PraxisEvent;
    await dispatchEvent(channel, event);
    expect(channel.onJobCompleted).toHaveBeenCalledWith(event);
  });

  it('calls onJobFailed for job.failed event', async () => {
    const channel: PraxisChannel = { onJobFailed: vi.fn().mockResolvedValue(undefined) };
    const event = { type: 'job.failed' } as PraxisEvent;
    await dispatchEvent(channel, event);
    expect(channel.onJobFailed).toHaveBeenCalledWith(event);
  });

  it('does not throw when handler is not implemented', async () => {
    const channel: PraxisChannel = {};
    const event = { type: 'plan.ready' } as PraxisEvent;
    await expect(dispatchEvent(channel, event)).resolves.toBeUndefined();
  });
});

// ── dispatchToConversation ────────────────────────────────────────────────────

function makeDb(rows: { id: string; type: string; config: unknown; enabled: boolean }[]) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  } as never;
}

function makeRegistry(channel: PraxisChannel): PluginRegistry<PraxisChannel> {
  return {
    create: vi.fn().mockReturnValue(channel),
    register: vi.fn(),
    has: vi.fn().mockReturnValue(true),
  } as unknown as PluginRegistry<PraxisChannel>;
}

const MOCK_LOG = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as never;

describe('dispatchToConversation', () => {
  it('does nothing when no enabled channels', async () => {
    const db = makeDb([{ id: 'c1', type: 'webhook', config: {}, enabled: false }]);
    const channel: PraxisChannel = { onPlanReady: vi.fn() };
    const registry = makeRegistry(channel);
    const event = { type: 'plan.ready' } as PraxisEvent;

    await dispatchToConversation(db, 'conv-1', event, MOCK_LOG, registry);
    expect(channel.onPlanReady).not.toHaveBeenCalled();
  });

  it('dispatches to all enabled channels', async () => {
    const db = makeDb([
      { id: 'c1', type: 'webhook', config: {}, enabled: true },
      { id: 'c2', type: 'webhook', config: {}, enabled: true },
    ]);
    const channel: PraxisChannel = { onPlanReady: vi.fn().mockResolvedValue(undefined) };
    const registry = makeRegistry(channel);
    const event = { type: 'plan.ready' } as PraxisEvent;

    await dispatchToConversation(db, 'conv-1', event, MOCK_LOG, registry);
    expect(channel.onPlanReady).toHaveBeenCalledTimes(2);
  });

  it('skips disabled channels', async () => {
    const db = makeDb([
      { id: 'c1', type: 'webhook', config: {}, enabled: true },
      { id: 'c2', type: 'webhook', config: {}, enabled: false },
    ]);
    const channel: PraxisChannel = { onPlanReady: vi.fn().mockResolvedValue(undefined) };
    const registry = makeRegistry(channel);
    const event = { type: 'plan.ready' } as PraxisEvent;

    await dispatchToConversation(db, 'conv-1', event, MOCK_LOG, registry);
    expect(channel.onPlanReady).toHaveBeenCalledTimes(1);
  });

  it('logs warn and continues when one channel throws', async () => {
    const db = makeDb([
      { id: 'c1', type: 'webhook', config: {}, enabled: true },
      { id: 'c2', type: 'webhook', config: {}, enabled: true },
    ]);
    let callCount = 0;
    const channel: PraxisChannel = {
      onPlanReady: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('webhook failed');
        return Promise.resolve();
      }),
    };
    const registry = makeRegistry(channel);
    const event = { type: 'plan.ready' } as PraxisEvent;
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

    await expect(
      dispatchToConversation(db, 'conv-1', event, log, registry),
    ).resolves.toBeUndefined();
    expect((log as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalled();
    expect(callCount).toBe(2);
  });
});
