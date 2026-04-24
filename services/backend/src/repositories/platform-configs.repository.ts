import type { Database } from '@shared/db';
import { platformConfigs } from '@shared/db';
import { eq } from 'drizzle-orm';

export class PlatformConfigsRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<
    Array<{ platform: string; enabled: boolean; config: Record<string, string> }>
  > {
    const rows = await this.db.select().from(platformConfigs);
    return rows.map((r) => ({
      platform: r.platform,
      enabled: r.enabled,
      config: (r.config ?? {}) as Record<string, string>,
    }));
  }

  async upsert(platform: string, enabled: boolean, config: Record<string, string>): Promise<void> {
    await this.db
      .insert(platformConfigs)
      .values({ platform, enabled, config })
      .onConflictDoUpdate({
        target: platformConfigs.platform,
        set: { enabled, config, updatedAt: new Date() },
      });
  }

  async delete(platform: string): Promise<void> {
    await this.db.delete(platformConfigs).where(eq(platformConfigs.platform, platform));
  }
}
