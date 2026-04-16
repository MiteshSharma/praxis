import type { NotifyEvent } from '@shared/contracts';
import { NotifierRegistry, type NotifyContext, type TaskNotifier } from '@shared/core';
import { publishJobChunk } from '@shared/stream';

/**
 * The only notifier in Phase 1. Publishes every event to the Redis job
 * stream that `/sse/jobs/:id` tails. Future third-party notifiers (Linear,
 * GitHub, Slack) plug into the same registry without touching the
 * orchestrator.
 */
export class WebNotifier implements TaskNotifier {
  readonly source = 'web' as const;

  async notify(event: NotifyEvent, ctx: NotifyContext): Promise<void> {
    await publishJobChunk(ctx.jobId, { seq: ctx.seq, event });
  }
}

/**
 * Builds the `NotifierRegistry` used by the control-plane's
 * `notify/dispatch` consumer.
 */
export function buildNotifierRegistry(): NotifierRegistry {
  return new NotifierRegistry(new Map([['web', new WebNotifier()]]));
}
