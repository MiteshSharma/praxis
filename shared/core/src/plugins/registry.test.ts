import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry } from './registry';

describe('PluginRegistry', () => {
  describe('create', () => {
    it('throws for unknown type', () => {
      const registry = new PluginRegistry<{ run: () => void }>();
      expect(() => registry.create('unknown-type', {})).toThrow('unknown plugin type: "unknown-type"');
    });

    it('throws when factory returns null', () => {
      const registry = new PluginRegistry<{ run: () => void }>();
      registry.register('my-type', () => null);
      expect(() => registry.create('my-type', {})).toThrow(
        'plugin "my-type" failed to initialize — check config',
      );
    });

    it('returns the instance when factory returns a value', () => {
      const registry = new PluginRegistry<{ run: () => void }>();
      const instance = { run: vi.fn() };
      registry.register('my-type', () => instance);
      expect(registry.create('my-type', {})).toBe(instance);
    });

    it('passes config to the factory', () => {
      const registry = new PluginRegistry<string, { value: string }>();
      const factory = vi.fn().mockReturnValue('hello');
      registry.register('cfg-type', factory);
      registry.create('cfg-type', { value: 'test' });
      expect(factory).toHaveBeenCalledWith({ value: 'test' });
    });
  });

  describe('has', () => {
    it('returns false when type is not registered', () => {
      const registry = new PluginRegistry();
      expect(registry.has('missing')).toBe(false);
    });

    it('returns true after registering a type', () => {
      const registry = new PluginRegistry();
      registry.register('present', () => 'val');
      expect(registry.has('present')).toBe(true);
    });
  });

  describe('types', () => {
    it('returns empty array for fresh registry', () => {
      const registry = new PluginRegistry();
      expect(registry.types()).toEqual([]);
    });

    it('returns all registered types', () => {
      const registry = new PluginRegistry();
      registry.register('alpha', () => 'a');
      registry.register('beta', () => 'b');
      expect(registry.types()).toEqual(['alpha', 'beta']);
    });

    it('overwrites are not duplicated in types list', () => {
      const registry = new PluginRegistry();
      registry.register('alpha', () => 'first');
      registry.register('alpha', () => 'second');
      expect(registry.types()).toEqual(['alpha']);
    });
  });

  describe('register (overwrite)', () => {
    it('second registration replaces the first factory', () => {
      const registry = new PluginRegistry<string>();
      registry.register('my-type', () => 'first');
      registry.register('my-type', () => 'second');
      expect(registry.create('my-type', {})).toBe('second');
    });
  });
});
