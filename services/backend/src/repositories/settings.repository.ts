import {
  type Database,
  SETTING_DEFAULTS,
  SETTING_DESCRIPTIONS,
  type SettingKey,
  settings,
} from '@shared/db';
import { eq } from 'drizzle-orm';

export class SettingsRepository {
  constructor(private readonly db: Database) {}

  /** Returns the value for a key, or the default if not yet persisted. */
  async get(key: SettingKey): Promise<string> {
    const row = await this.db.query.settings.findFirst({ where: eq(settings.key, key) });
    return row?.value ?? SETTING_DEFAULTS[key];
  }

  /** Returns all known settings, seeding missing ones with their defaults. */
  async listAll(): Promise<Array<{ key: SettingKey; value: string; updatedAt: Date }>> {
    const rows = await this.db.query.settings.findMany();
    const rowMap = new Map(rows.map((r) => [r.key, r]));

    return (Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((key) => {
      const row = rowMap.get(key);
      return {
        key,
        value: row?.value ?? SETTING_DEFAULTS[key],
        updatedAt: row?.updatedAt ?? new Date(0),
      };
    });
  }

  /** Upserts a setting value. Throws if key is not a known setting key. */
  async set(key: string, value: string): Promise<{ key: string; value: string; updatedAt: Date }> {
    if (!(key in SETTING_DEFAULTS)) {
      throw new Error(`Unknown setting key: "${key}"`);
    }
    const now = new Date();
    await this.db
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
    return { key, value, updatedAt: now };
  }
}
