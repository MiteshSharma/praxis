import type { PraxisChannel } from '../../channels/types.js';
import { PluginRegistry } from '../registry.js';

export const channelRegistry = new PluginRegistry<PraxisChannel, unknown>();
const validateFns = new Map<string, (config: unknown) => void>();

export function registerChannel(
  type: string,
  factory: (config: unknown) => PraxisChannel | null,
  validate?: (config: unknown) => void,
): void {
  if (validate) validateFns.set(type, validate);
  channelRegistry.register(type, factory);
}

export function validateChannelConfig(type: string, config: unknown): void {
  if (!channelRegistry.has(type)) throw new Error(`unknown channel type: "${type}"`);
  validateFns.get(type)?.(config);
}
