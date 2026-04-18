import type { PraxisEvent } from '@shared/contracts';
import type { Database } from '@shared/db';
import { conversationChannels } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import '../plugins/channels/index.js';
import { channelRegistry as defaultChannelRegistry } from '../plugins/channels/registry.js';
import type { PluginRegistry } from '../plugins/registry.js';
import type { PraxisChannel } from './types.js';

export async function dispatchEvent(channel: PraxisChannel, event: PraxisEvent): Promise<void> {
  switch (event.type) {
    case 'plan.ready':    return channel.onPlanReady?.(event);
    case 'job.completed': return channel.onJobCompleted?.(event);
    case 'job.failed':    return channel.onJobFailed?.(event);
  }
}

/**
 * Loads all enabled channels for a conversation and dispatches the event
 * fire-and-forget. Failures are logged but never throw.
 */
export async function dispatchToConversation(
  db: Database,
  conversationId: string,
  event: PraxisEvent,
  log: Logger,
  registry: PluginRegistry<PraxisChannel> = defaultChannelRegistry,
): Promise<void> {
  const rows = await db
    .select()
    .from(conversationChannels)
    .where(eq(conversationChannels.conversationId, conversationId));

  const enabled = rows.filter((r) => r.enabled);
  if (enabled.length === 0) return;

  await Promise.allSettled(
    enabled.map(async (row) => {
      try {
        const channel = registry.create(row.type, row.config);
        await dispatchEvent(channel, event);
        log.info({ channelId: row.id, type: row.type }, 'channel event dispatched');
      } catch (err) {
        log.warn({ err, channelId: row.id, type: row.type }, 'channel event failed');
      }
    }),
  );
}
