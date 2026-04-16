import { z } from 'zod';

export const PromptBodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  jobId: z.string().min(1, 'jobId is required'),
  title: z.string().min(1, 'title is required'),
  description: z.string().nullable().optional(),
  workingDir: z.string().min(1, 'workingDir is required'),
  env: z.record(z.string(), z.string()).optional(),
});
export type PromptBody = z.infer<typeof PromptBodySchema>;
