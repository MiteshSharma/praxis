import { z } from 'zod';

export const JOB_STATUSES = [
  'queued',
  'provisioning',
  'preparing',
  'building',
  'plan_ready',
  'plan_review',
  'plan_revising',
  'plan_rejected',
  'executing',
  'checking',
  'learning',
  'publishing',
  'completed',
  'failed',
] as const;

export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** Valid state transitions. Any other combination is a bug. */
export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ['provisioning'],
  provisioning: ['preparing', 'failed'],
  preparing: ['building', 'executing', 'checking', 'publishing', 'failed'],
  building: ['plan_ready', 'failed'],
  plan_ready: ['plan_review'],
  plan_review: ['plan_revising', 'preparing', 'executing', 'plan_rejected', 'failed'],
  plan_revising: ['plan_ready', 'failed'],
  executing: ['checking', 'executing', 'preparing', 'learning', 'publishing', 'failed'],
  checking: ['checking', 'executing', 'learning', 'publishing', 'failed'],
  learning: ['completed', 'failed'],
  publishing: ['learning', 'completed', 'failed'],
  completed: [],
  plan_rejected: [],
  failed: ['queued'],
};

/**
 * Throws if the `from → to` transition is not in `JOB_TRANSITIONS`.
 * Call this before every `transitionJob` to catch invalid flows early.
 */
export function assertTransition(from: JobStatus, to: JobStatus): void {
  const allowed = JOB_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid job transition: ${from} → ${to}`);
  }
}

/** Wake signal published to Redis channel `run:{jobId}:plan-event` */
export const PlanWakeEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approve') }),
  z.object({ kind: z.literal('revise'), planVersion: z.number().int() }),
  z.object({ kind: z.literal('reject') }),
]);
export type PlanWakeEvent = z.infer<typeof PlanWakeEventSchema>;

export const NotifyEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('job-created') }),
  z.object({
    kind: z.literal('status-changed'),
    from: JobStatusSchema,
    to: JobStatusSchema,
  }),
  z.object({
    kind: z.literal('chunk'),
    text: z.string().optional(),
    raw: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal('artifact-created'),
    artifactId: z.string().uuid(),
    artifactKind: z.string(),
    url: z.string().optional(),
  }),
  z.object({
    kind: z.literal('completed'),
    diffArtifactId: z.string().uuid().optional(),
    summary: z.string().optional(),
  }),
  z.object({
    kind: z.literal('failed'),
    error: z.string(),
    errorCategory: z.string(),
  }),
]);
export type NotifyEvent = z.infer<typeof NotifyEventSchema>;

export const NotifyPayloadSchema = z.object({
  jobId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  emittedAt: z.string(),
  event: NotifyEventSchema,
});
export type NotifyPayload = z.infer<typeof NotifyPayloadSchema>;
