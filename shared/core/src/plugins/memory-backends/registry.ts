import type { MemoryBackend } from '@shared/memory';
import { PluginRegistry } from '../registry.js';

export const memoryBackendRegistry = new PluginRegistry<MemoryBackend, unknown>();

export function registerMemoryBackend(
  type: string,
  factory: (config: unknown) => MemoryBackend | null,
): void {
  memoryBackendRegistry.register(type, factory);
}
