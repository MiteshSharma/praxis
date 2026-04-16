import { oc } from '@orpc/contract';
import { z } from 'zod';
import { ArtifactSchema, JobSchema } from './schemas';

/**
 * The contract. Handlers are implemented in services/backend via oRPC's
 * `implement()` pattern — this file has no runtime behavior, only the shape
 * of the API surface that the web client and backend share.
 */
export const contract = {
  health: oc.output(z.object({ ok: z.boolean(), service: z.string() })),

  jobs: {
    create: oc
      .input(
        z.object({
          githubUrl: z.string().url(),
          githubBranch: z.string().default('main'),
          input: z.string().min(1, 'input is empty'),
        }),
      )
      .output(z.object({ jobId: z.string().uuid() })),

    get: oc.input(z.object({ jobId: z.string().uuid() })).output(JobSchema),

    list: oc
      .input(z.object({ limit: z.number().int().positive().max(100).default(50) }).optional())
      .output(z.array(JobSchema)),

    listArtifacts: oc.input(z.object({ jobId: z.string().uuid() })).output(z.array(ArtifactSchema)),
  },
};

export type Contract = typeof contract;
