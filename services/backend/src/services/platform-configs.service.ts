import type { SecretBackend } from '@shared/core';
import type { PlatformConfigsRepository } from '../repositories/platform-configs.repository';

function secretKey(platform: string): string {
  return `platform:${platform}`;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••';
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`;
}

export class PlatformConfigsService {
  constructor(
    private readonly repo: PlatformConfigsRepository,
    private readonly secretBackend: SecretBackend,
  ) {}

  async list(): Promise<
    Array<{
      platform: string;
      enabled: boolean;
      configured: boolean;
      maskedSecrets: Record<string, string> | null;
      config: Record<string, string>;
    }>
  > {
    const rows = await this.repo.list();
    return Promise.all(
      rows.map(async (row) => {
        const raw = await this.secretBackend.get(secretKey(row.platform));
        let maskedSecrets: Record<string, string> | null = null;
        if (raw) {
          try {
            const parsed: Record<string, string> = JSON.parse(raw);
            maskedSecrets = Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [k, maskSecret(v)]),
            );
          } catch {
            maskedSecrets = null;
          }
        }
        return {
          platform: row.platform,
          enabled: row.enabled,
          configured: raw !== null,
          maskedSecrets,
          config: row.config,
        };
      }),
    );
  }

  async upsert(
    platform: string,
    secrets: Record<string, string>,
    config: Record<string, string> = {},
    enabled = true,
  ): Promise<void> {
    // Merge new secrets with existing so updating one field doesn't wipe the other
    const existing = await this.secretBackend.get(secretKey(platform));
    let merged: Record<string, string> = {};
    if (existing) {
      try {
        merged = JSON.parse(existing);
      } catch {
        merged = {};
      }
    }
    Object.assign(merged, secrets);
    await this.secretBackend.set(secretKey(platform), JSON.stringify(merged));
    await this.repo.upsert(platform, enabled, config);
  }

  async delete(platform: string): Promise<void> {
    await this.secretBackend.delete(secretKey(platform));
    await this.repo.delete(platform);
  }

  /** Full secrets blob — server-side only. Never send to client. */
  async getSecrets(platform: string): Promise<Record<string, string> | null> {
    const raw = await this.secretBackend.get(secretKey(platform));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
