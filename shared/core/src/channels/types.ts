import type { PraxisEvent } from '@shared/contracts';

type PlanReadyEvent = Extract<PraxisEvent, { type: 'plan.ready' }>;
type JobCompletedEvent = Extract<PraxisEvent, { type: 'job.completed' }>;
type JobFailedEvent = Extract<PraxisEvent, { type: 'job.failed' }>;
type PrReviewRequestEvent = Extract<PraxisEvent, { type: 'pr.review_requested' }>;

export interface PraxisChannelMeta {
  label: string;
  description: string;
}

export interface PraxisChannel {
  readonly type: string;
  readonly meta: PraxisChannelMeta;

  // Optional event handlers — implement only what this channel supports
  onPlanReady?: (event: PlanReadyEvent) => Promise<void>;
  onJobCompleted?: (event: JobCompletedEvent) => Promise<void>;
  onJobFailed?: (event: JobFailedEvent) => Promise<void>;
  /**
   * Called when a PR review requests changes.
   * Implement this to auto-create a follow-up job from review comments.
   * Approach B (UI): dispatched manually by the user clicking "Fix Review Comments".
   * Approach A (GitHub webhook): dispatched automatically when GitHub fires
   *   a pull_request_review event with state=changes_requested.
   */
  onPrReviewRequested?: (event: PrReviewRequestEvent) => Promise<void>;
}
