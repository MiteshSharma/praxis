import type { Job } from '@shared/db';
import type { TaskSourceName } from '../ingress/task-source';
import type { TaskNotifier } from './task-notifier';

export class NotifierRegistry {
  constructor(private readonly notifiers: Map<TaskSourceName, TaskNotifier>) {}

  resolveForJob(job: Pick<Job, 'source'>): TaskNotifier {
    const notifier = this.notifiers.get(job.source as TaskSourceName);
    if (!notifier) {
      throw new Error(`no notifier registered for source ${job.source}`);
    }
    return notifier;
  }

  resolve(source: TaskSourceName): TaskNotifier | undefined {
    return this.notifiers.get(source);
  }
}
