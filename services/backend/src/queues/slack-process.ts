import type { Logger } from '@shared/telemetry';
import type PgBoss from 'pg-boss';
import type { HandlerDeps } from '../adapters/handlers';
import { handleIncoming } from '../adapters/handlers';
import type { IncomingMessage } from '../adapters/types';

export const SLACK_PROCESS_QUEUE = 'slack/process-event';

/**
 * Registers the async Slack event consumer.
 * The HTTP route acks Slack immediately (200 + challenge), then enqueues here.
 * This worker does the actual intent classification and response.
 */
export async function registerSlackProcess(
  boss: PgBoss,
  deps: HandlerDeps & { log: Logger },
): Promise<void> {
  await boss.createQueue(SLACK_PROCESS_QUEUE, {
    name: SLACK_PROCESS_QUEUE,
    policy: 'standard',
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: 5,
    expireInSeconds: 120,
  } as Parameters<typeof boss.createQueue>[1]);

  await boss.work<IncomingMessage>(
    SLACK_PROCESS_QUEUE,
    // biome-ignore lint/suspicious/noExplicitAny: teamSize is valid but missing from pg-boss types
    { batchSize: 1, teamSize: 4 } as any,
    async (batch) => {
      for (const job of batch) {
        const msg = job.data;
        try {
          await handleIncoming(msg, deps);
        } catch (err) {
          deps.log.error(
            { err, chatId: msg.chatId },
            'slack process: handler error; pg-boss will retry',
          );
          throw err;
        }
      }
    },
  );

  deps.log.info({ queue: SLACK_PROCESS_QUEUE }, 'slack-process consumer started');
}
