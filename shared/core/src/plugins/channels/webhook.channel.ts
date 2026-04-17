import type { PraxisChannel, PraxisChannelMeta } from '../../channels/types.js';
import { registerChannel } from './registry.js';

class WebhookChannel implements PraxisChannel {
  readonly type = 'webhook';
  readonly meta: PraxisChannelMeta = {
    label: 'Webhook',
    description: 'POSTs plan data + callback token to a URL for external review.',
  };

  constructor(private readonly url: string) {}

  async onPlanReady(event: Extract<import('@shared/contracts').PraxisEvent, { type: 'plan.ready' }>): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      throw new Error(`webhook POST failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
  }
}

registerChannel(
  'webhook',
  (config) => {
    const cfg = config as { url?: string };
    if (!cfg.url) return null;
    return new WebhookChannel(cfg.url);
  },
  (config) => {
    const cfg = config as { url?: string };
    if (!cfg.url) throw new Error('webhook channel requires a "url" in config');
  },
);
