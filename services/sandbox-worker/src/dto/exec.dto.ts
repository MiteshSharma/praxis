import { z } from 'zod';

export const ExecInputSchema = z.object({
  command: z.string().min(1, 'command is required'),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutSeconds: z.number().int().positive().optional(),
});
export type ExecInput = z.infer<typeof ExecInputSchema>;

export const ExecResultSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
});
export type ExecResult = z.infer<typeof ExecResultSchema>;
