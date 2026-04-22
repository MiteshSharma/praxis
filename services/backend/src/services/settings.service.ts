import { ORPCError } from '@orpc/server';
import { SETTING_DEFAULTS, SETTING_DESCRIPTIONS, type SettingKey } from '@shared/db';
import type { SettingDto } from '@shared/contracts';
import type { SettingsRepository } from '../repositories/settings.repository';

export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  async list(): Promise<SettingDto[]> {
    const rows = await this.repo.listAll();
    return rows.map((r) => this.toDto(r.key as SettingKey, r.value, r.updatedAt));
  }

  async update(key: string, value: string): Promise<SettingDto> {
    if (!(key in SETTING_DEFAULTS)) {
      throw new ORPCError('BAD_REQUEST', { message: `Unknown setting key: "${key}"` });
    }
    if (!value.trim()) {
      throw new ORPCError('BAD_REQUEST', { message: 'Setting value cannot be empty' });
    }
    const row = await this.repo.set(key, value.trim());
    return this.toDto(row.key as SettingKey, row.value, row.updatedAt);
  }

  /** Called by job-orchestrator to read a model setting at job execution time. */
  async getModel(key: SettingKey): Promise<string> {
    return this.repo.get(key);
  }

  private toDto(key: SettingKey, value: string, updatedAt: Date): SettingDto {
    return {
      key,
      value,
      description: SETTING_DESCRIPTIONS[key],
      defaultValue: SETTING_DEFAULTS[key],
      updatedAt: updatedAt.getTime() === 0 ? new Date().toISOString() : updatedAt.toISOString(),
    };
  }
}
