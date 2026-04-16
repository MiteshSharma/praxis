import type { NotifyPayload } from '@shared/contracts';
import { NOTIFY_DISPATCH_QUEUE, type NotifierRegistry } from '@shared/core';
import { type Database, jobs } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';

/**
 * Consumes `notify/dispatch` events and routes each one through the
 * registered `TaskNotifier` for the job's source. Runs only in the
 * control-plane role.
 */
export async function registerNotifyDispatch(
  boss: PgBoss,
  deps: { db: Database; registry: NotifierRegistry; log: Logger },
): Promise<void> {
  await boss.createQueue(NOTIFY_DISPATCH_QUEUE, {
    name: NOTIFY_DISPATCH_QUEUE,
    policy: 'standard',
    retryLimit: 3,
    retryBackoff: true,
    retryDelay: 2,
    expireInSeconds: 300,
  } as Parameters<typeof boss.createQueue>[1]);

  await boss.work<NotifyPayload>(NOTIFY_DISPATCH_QUEUE, { batchSize: 1 }, async (batch) => {
    for (const job of batch) {
      const payload = job.data;
      const jobRow = await deps.db.query.jobs.findFirst({
        where: eq(jobs.id, payload.jobId),
      });
      if (!jobRow) {
        deps.log.warn({ jobId: payload.jobId }, 'notify: job row missing, dropping');
        continue;
      }
      const notifier = deps.registry.resolveForJob(jobRow);
      try {
        await notifier.notify(payload.event, {
          db: deps.db,
          log: deps.log,
          jobId: payload.jobId,
          seq: payload.seq,
        });
      } catch (err) {
        deps.log.error(
          { err, jobId: payload.jobId, event: payload.event.kind },
          'notifier threw; pg-boss will retry',
        );
        throw err;
      }
    }
  });

  boss.on('error', (err) => deps.log.error({ err }, 'notify consumer pg-boss error'));
  deps.log.info({ queue: NOTIFY_DISPATCH_QUEUE }, 'notify-dispatch consumer started');
}
