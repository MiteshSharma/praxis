import { type Database, secrets } from '@shared/db';
import { eq } from 'drizzle-orm';
import { registerSecretBackend } from './registry.js';
import type { SecretBackend } from './types.js';

/**
 * Default secret backend — stores key/value pairs in the `secrets` Postgres table.
 * Suitable for development and single-node deployments.
 * Replace with a vault-backed backend for production multi-tenant use.
 */
class DbSecretBackend implements SecretBackend {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.query.secrets.findFirst({ where: eq(secrets.key, key) });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(secrets)
      .values({ key, value })
      .onConflictDoUpdate({
        target: secrets.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(secrets).where(eq(secrets.key, key));
  }
}

registerSecretBackend('db', (config) => {
  if (!config.db) return null;
  return new DbSecretBackend(config.db);
});
