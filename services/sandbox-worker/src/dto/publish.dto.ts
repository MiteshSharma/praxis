import { z } from 'zod';

export const PublishInputSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  repoUrl: z.string().url('repoUrl must be a valid URL'),
  baseBranch: z.string().min(1, 'baseBranch is required'),
  branchName: z.string().min(1, 'branchName is required'),
  commitMessage: z.string().min(1, 'commitMessage is required'),
  prTitle: z.string().min(1, 'prTitle is required'),
  prBody: z.string(),
  githubToken: z.string().min(1, 'githubToken is required'),
  gitAuthor: z.object({
    name: z.string().min(1),
    email: z.string().email('gitAuthor.email must be a valid email'),
  }),
  workingDir: z.string().min(1, 'workingDir is required'),
});
export type PublishInput = z.infer<typeof PublishInputSchema>;

export const PublishResultSchema = z.object({
  branchName: z.string(),
  commitSha: z.string(),
  prNumber: z.number().int(),
  prUrl: z.string().url(),
});
export type PublishResult = z.infer<typeof PublishResultSchema>;
