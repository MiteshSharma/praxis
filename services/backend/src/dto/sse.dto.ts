import { z } from 'zod';

// ---------------------------------------------------------------------------
// Path params
// ---------------------------------------------------------------------------

export const SseJobParamsSchema = z.object({
  id: z.string().min(1, 'job id is required'),
});
export type SseJobParams = z.infer<typeof SseJobParamsSchema>;

// ---------------------------------------------------------------------------
// Response shape (for OpenAPI docs)
// ---------------------------------------------------------------------------

export const SseChunkSchema = z.object({
  id: z.string(),
  data: z.unknown(),
});
export type SseChunk = z.infer<typeof SseChunkSchema>;
