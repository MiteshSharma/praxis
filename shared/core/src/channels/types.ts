import type { PraxisEvent } from '@shared/contracts';

type PlanReadyEvent    = Extract<PraxisEvent, { type: 'plan.ready' }>;
type JobCompletedEvent = Extract<PraxisEvent, { type: 'job.completed' }>;
type JobFailedEvent    = Extract<PraxisEvent, { type: 'job.failed' }>;

export interface PraxisChannelMeta {
  label: string;
  description: string;
}

export interface PraxisChannel {
  readonly type: string;
  readonly meta: PraxisChannelMeta;

  // Optional event handlers — implement only what this channel supports
  onPlanReady?:    (event: PlanReadyEvent)    => Promise<void>;
  onJobCompleted?: (event: JobCompletedEvent) => Promise<void>;
  onJobFailed?:    (event: JobFailedEvent)    => Promise<void>;
}
