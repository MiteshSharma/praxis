import type { NotifyEvent } from '@shared/contracts';
import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type { TaskSourceName } from '../ingress/task-source';

export interface NotifyContext {
  db: Database;
  log: Logger;
  jobId: string;
  seq: number;
}

export interface TaskNotifier {
  readonly source: TaskSourceName;
  notify(event: NotifyEvent, ctx: NotifyContext): Promise<void>;
}
