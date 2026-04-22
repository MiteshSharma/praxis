import { PluginRegistry } from '../registry.js';
import type { SecretBackend, SecretBackendConfig } from './types.js';

export const secretBackendRegistry = new PluginRegistry<SecretBackend, SecretBackendConfig>();

export function registerSecretBackend(
  type: string,
  factory: (config: SecretBackendConfig) => SecretBackend | null,
): void {
  secretBackendRegistry.register(type, factory);
}
