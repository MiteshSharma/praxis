// Import built-in implementations to trigger self-registration.
import './channels/index.js';
import './memory-backends/index.js';
import './secret-backends/index.js';

// Re-export registries
export { channelRegistry, registerChannel, validateChannelConfig } from './channels/registry.js';
export { memoryBackendRegistry, registerMemoryBackend } from './memory-backends/registry.js';
export { secretBackendRegistry, registerSecretBackend } from './secret-backends/registry.js';
export type { SecretBackend, SecretBackendConfig } from './secret-backends/types.js';
