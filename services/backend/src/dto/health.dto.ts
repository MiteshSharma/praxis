import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  role: z.string(),
  time: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
