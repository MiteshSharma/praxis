import { z } from 'zod';

export const AbortInputSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
});
export type AbortInput = z.infer<typeof AbortInputSchema>;
