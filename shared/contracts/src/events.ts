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
  'finalizing',
  'completed',
  'failed',
] as const;

export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

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
