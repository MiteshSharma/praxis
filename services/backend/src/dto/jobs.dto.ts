/**
 * DTOs for job-related requests and responses on non-oRPC surfaces
 * (webhooks, direct REST routes). oRPC procedures use @shared/contracts
 * directly — those schemas ARE the DTOs for the RPC layer.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Path params
// ---------------------------------------------------------------------------

export const JobParamsSchema = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
});
export type JobParams = z.infer<typeof JobParamsSchema>;

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const JobListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
});
export type JobListQuery = z.infer<typeof JobListQuerySchema>;
