import type { Database } from '@shared/db';
import { providerConfigs } from '@shared/db';
import { eq } from 'drizzle-orm';

export class ProviderConfigsRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Array<{ provider: string; config: Record<string, string> }>> {
    const rows = await this.db.select().from(providerConfigs);
    return rows.map((r) => ({
      provider: r.provider,
      config: (r.config ?? {}) as Record<string, string>,
    }));
  }

  async upsert(provider: string, config: Record<string, string>): Promise<void> {
    await this.db
      .insert(providerConfigs)
      .values({ provider, config })
      .onConflictDoUpdate({
        target: providerConfigs.provider,
        set: { config, updatedAt: new Date() },
      });
  }

  async delete(provider: string): Promise<void> {
    await this.db.delete(providerConfigs).where(eq(providerConfigs.provider, provider));
  }
}
