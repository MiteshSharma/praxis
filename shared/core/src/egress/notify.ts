import type { NotifyEvent, NotifyPayload } from '@shared/contracts';
import type PgBoss from 'pg-boss';

export const NOTIFY_DISPATCH_QUEUE = 'notify/dispatch';

export async function emitNotification(
  boss: PgBoss,
  jobId: string,
  seq: number,
  event: NotifyEvent,
): Promise<void> {
  const payload: NotifyPayload = {
    jobId,
    seq,
    emittedAt: new Date().toISOString(),
    event,
  };
  await boss.send(NOTIFY_DISPATCH_QUEUE, payload);
}
