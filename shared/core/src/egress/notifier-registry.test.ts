import { describe, it, expect, vi } from 'vitest';
import { NotifierRegistry } from './notifier-registry';

function makeNotifier() {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

describe('NotifierRegistry', () => {
  describe('resolveForJob', () => {
    it('returns the notifier for the job source', () => {
      const webNotifier = makeNotifier();
      const registry = new NotifierRegistry(
        new Map([['web', webNotifier]]) as never,
      );
      const result = registry.resolveForJob({ source: 'web' } as never);
      expect(result).toBe(webNotifier);
    });

    it('throws when no notifier is registered for the job source', () => {
      const registry = new NotifierRegistry(new Map() as never);
      expect(() => registry.resolveForJob({ source: 'webhook' } as never)).toThrow(
        'no notifier registered for source webhook',
      );
    });

    it('error message includes the source name', () => {
      const registry = new NotifierRegistry(new Map() as never);
      expect(() => registry.resolveForJob({ source: 'slack-channel' } as never)).toThrow(
        'slack-channel',
      );
    });
  });

  describe('resolve', () => {
    it('returns the notifier when source is registered', () => {
      const webNotifier = makeNotifier();
      const registry = new NotifierRegistry(
        new Map([['web', webNotifier]]) as never,
      );
      expect(registry.resolve('web' as never)).toBe(webNotifier);
    });

    it('returns undefined for an unknown source', () => {
      const registry = new NotifierRegistry(new Map() as never);
      expect(registry.resolve('unknown' as never)).toBeUndefined();
    });
  });
});
