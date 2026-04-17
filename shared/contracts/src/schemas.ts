import { z } from 'zod';
import { JobStatusSchema } from './events';

export const PlanStepSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'done', 'skipped']),
});

export const OpenQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string().optional(),
  options: z.array(z.string()).optional(),
  answer: z.string().nullable(),
});

export const PlanDataSchema = z.object({
  title: z.string(),
  summary: z.string(),
  bodyMarkdown: z.string(),
  steps: z.array(PlanStepSchema),
  affectedPaths: z.array(z.string()),
  risks: z.array(z.string()).optional(),
  openQuestions: z.array(OpenQuestionSchema).optional(),
});

export const PlanStatusSchema = z.enum(['draft', 'ready', 'needs_answers', 'approved', 'rejected']);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  version: z.number().int(),
  previousPlanId: z.string().uuid().nullable(),
  contentUri: z.string(),
  data: PlanDataSchema,
  status: PlanStatusSchema,
  feedbackFromUser: z.string().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlanDto = z.infer<typeof PlanSchema>;

export const JobSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
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
  totalInputTokens: z.number().int().nullable().optional(),
  totalOutputTokens: z.number().int().nullable().optional(),
  totalCostUsd: z.number().nullable().optional(),
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

// ── Job steps ─────────────────────────────────────────────────────────────────

export const JobStepSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  stepIndex: z.number().int(),
  retryOf: z.string().uuid().nullable(),
  kind: z.string(),
  name: z.string(),
  config: z.record(z.unknown()),
  status: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  output: z.record(z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
});
export type JobStepDto = z.infer<typeof JobStepSchema>;

// ── Agents ────────────────────────────────────────────────────────────────────

export const AgentVersionSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  version: z.number().int(),
  source: z.string(),
  contentUri: z.string(),
  definition: z.record(z.unknown()),
  createdAt: z.string(),
});
export type AgentVersionDto = z.infer<typeof AgentVersionSchema>;

export const AgentSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['agent', 'skill']),
  name: z.string(),
  description: z.string(),
  latestVersion: AgentVersionSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentDto = z.infer<typeof AgentSchema>;

// ── Workflows ─────────────────────────────────────────────────────────────────

export const WorkflowVersionSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  version: z.number().int(),
  source: z.string(),
  contentUri: z.string(),
  definition: z.record(z.unknown()),
  createdAt: z.string(),
});
export type WorkflowVersionDto = z.infer<typeof WorkflowVersionSchema>;

export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  latestVersion: WorkflowVersionSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowDto = z.infer<typeof WorkflowSchema>;

// ── Conversations & messages ──────────────────────────────────────────────────

export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  jobId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  defaultGithubUrl: z.string().nullable(),
  defaultWorkflowId: z.string().uuid().nullable(),
  planHoldHours: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationDto = z.infer<typeof ConversationSchema>;

// ── Repo Memories ─────────────────────────────────────────────────────────────

export const RepoMemoryListItemSchema = z.object({
  repoKey: z.string(),
  sizeBytes: z.number(),
  entryCount: z.number(),
  updatedAt: z.string(),
});
export type RepoMemoryListItemDto = z.infer<typeof RepoMemoryListItemSchema>;

export const RepoMemorySchema = RepoMemoryListItemSchema.extend({
  content: z.string(),
});
export type RepoMemoryDto = z.infer<typeof RepoMemorySchema>;

// ── Conversation channels ─────────────────────────────────────────────────────

export const ConversationChannelSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  type: z.enum(['webhook']),
  name: z.string(),
  config: z.record(z.unknown()),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type ConversationChannelDto = z.infer<typeof ConversationChannelSchema>;

// ── Plugins ───────────────────────────────────────────────────────────────────

export const PluginSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  name: z.string(),
  transport: z.enum(['stdio', 'http']),
  command: z.string().nullable(),
  url: z.string().nullable(),
  env: z.record(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type PluginDto = z.infer<typeof PluginSchema>;
