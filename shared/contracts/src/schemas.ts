import { z } from 'zod';
import { JobStatusSchema } from './events';

export const JobSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  triggerKind: z.string(),
  githubUrl: z.string(),
  githubBranch: z.string(),
  githubCommitSha: z.string().nullable(),
  status: JobStatusSchema,
  errorMessage: z.string().nullable(),
  errorCategory: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type JobDto = z.infer<typeof JobSchema>;

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  kind: z.string(),
  path: z.string().nullable(),
  url: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});
export type ArtifactDto = z.infer<typeof ArtifactSchema>;
