import type { AgentProvider } from './types.js';

type ProviderMatcher = (model: string, env: Record<string, string>) => boolean;
type ProviderFactory = () => AgentProvider;

/**
 * Ordered list of (matcher, factory) pairs. First match wins.
 * Providers self-register by calling registerProvider() at module level.
 * Demo provider must be registered last — it matches everything (catch-all).
 */
class ProviderRegistry {
  private readonly entries: Array<{ matcher: ProviderMatcher; factory: ProviderFactory }> = [];

  register(matcher: ProviderMatcher, factory: ProviderFactory): void {
    this.entries.push({ matcher, factory });
  }

  resolve(model: string, env: Record<string, string>): AgentProvider {
    const entry = this.entries.find((e) => e.matcher(model, env));
    if (!entry) throw new Error(`no provider found for model: "${model}"`);
    return entry.factory();
  }
}

export const providerRegistry = new ProviderRegistry();

export function registerProvider(matcher: ProviderMatcher, factory: ProviderFactory): void {
  providerRegistry.register(matcher, factory);
}
