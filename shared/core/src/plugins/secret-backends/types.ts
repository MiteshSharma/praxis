import type { Database } from '@shared/db';

export interface SecretBackend {
  /** Retrieve a secret by its logical key. Returns null if not found. */
  get(key: string): Promise<string | null>;
  /** Store or overwrite a secret. */
  set(key: string, value: string): Promise<void>;
  /** Remove a secret. No-op if the key does not exist. */
  delete(key: string): Promise<void>;
}

/** Config passed to every SecretBackend factory. */
export interface SecretBackendConfig {
  db?: Database;
}
