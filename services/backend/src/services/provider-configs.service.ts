import type { SecretBackend } from '@shared/core';
import type { ProviderConfigsRepository } from '../repositories/provider-configs.repository';

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export interface ProviderConfigDto {
  provider: SupportedProvider;
  configured: boolean;
  maskedKey: string | null;
  config: Record<string, string>;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${'•'.repeat(key.length - 4)}${key.slice(-4)}`;
}

function secretKey(provider: string): string {
  return `provider:${provider}`;
}

export class ProviderConfigsService {
  constructor(
    private readonly repo: ProviderConfigsRepository,
    private readonly secretBackend: SecretBackend,
  ) {}

  async list(): Promise<ProviderConfigDto[]> {
    const rows = await this.repo.list();
    const rowMap = new Map(rows.map((r) => [r.provider, r.config]));

    return Promise.all(
      SUPPORTED_PROVIDERS.map(async (provider) => {
        const rawKey = await this.secretBackend.get(secretKey(provider));
        return {
          provider,
          configured: rawKey !== null,
          maskedKey: rawKey ? maskKey(rawKey) : null,
          config: rowMap.get(provider) ?? {},
        };
      }),
    );
  }

  async upsert(provider: SupportedProvider, apiKey: string, config: Record<string, string> = {}): Promise<void> {
    await this.secretBackend.set(secretKey(provider), apiKey);
    await this.repo.upsert(provider, config);
  }

  async delete(provider: SupportedProvider): Promise<void> {
    await this.secretBackend.delete(secretKey(provider));
    await this.repo.delete(provider);
  }

  /** Full key — server-side only. Never send to client. */
  async getApiKey(provider: string): Promise<string | null> {
    return this.secretBackend.get(secretKey(provider));
  }
}
