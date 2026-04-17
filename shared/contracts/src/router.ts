import { oc } from '@orpc/contract';
import { z } from 'zod';
import { AgentSchema, ArtifactSchema, ConversationChannelSchema, ConversationSchema, JobSchema, JobStepSchema, MessageSchema, PlanSchema, PluginSchema, RepoMemoryListItemSchema, RepoMemorySchema, WorkflowSchema } from './schemas';

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
          /** Optional: workflow version to use. Defaults to the hardcoded DEFAULT_WORKFLOW. */
          workflowVersionId: z.string().uuid().optional(),
        }),
      )
      .output(z.object({ jobId: z.string().uuid() })),

    get: oc.input(z.object({ jobId: z.string().uuid() })).output(JobSchema),

    list: oc
      .input(z.object({ limit: z.number().int().positive().max(100).default(50) }).optional())
      .output(z.array(JobSchema)),

    listArtifacts: oc.input(z.object({ jobId: z.string().uuid() })).output(z.array(ArtifactSchema)),

    getLatestPlan: oc
      .input(z.object({ jobId: z.string().uuid() }))
      .output(PlanSchema.nullable()),

    listPlans: oc
      .input(z.object({ jobId: z.string().uuid() }))
      .output(z.array(PlanSchema)),

    approvePlan: oc
      .input(z.object({ jobId: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() })),

    revisePlan: oc
      .input(
        z.object({
          jobId: z.string().uuid(),
          answers: z.record(z.string()).optional(),
          additionalFeedback: z.string().optional(),
        }),
      )
      .output(z.object({ ok: z.boolean() })),

    rejectPlan: oc
      .input(z.object({ jobId: z.string().uuid(), reason: z.string().optional() }))
      .output(z.object({ ok: z.boolean() })),

    listSteps: oc
      .input(z.object({ jobId: z.string().uuid() }))
      .output(z.array(JobStepSchema)),

    restart: oc
      .input(z.object({ jobId: z.string().uuid() }))
      .output(z.object({ jobId: z.string().uuid() })),

    delete: oc
      .input(z.object({ jobId: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() })),

    resumeFromPlan: oc
      .input(z.object({ jobId: z.string().uuid() }))
      .output(z.object({ jobId: z.string().uuid() })),
  },

  workflows: {
    list: oc
      .input(z.object({ limit: z.number().int().positive().max(100).default(50) }).optional())
      .output(z.array(WorkflowSchema)),

    get: oc
      .input(z.object({ id: z.string().uuid() }))
      .output(WorkflowSchema),

    create: oc
      .input(
        z.object({
          source: z.enum(['inline', 'github', 'form']),
          // form source
          name: z.string().optional(),
          description: z.string().optional(),
          steps: z
            .array(
              z.object({
                kind: z.enum(['plan', 'execute', 'check']),
                name: z.string(),
                agentId: z.string().uuid().optional(),
                skillId: z.string().uuid().optional(),
                condition: z.enum(['previous_check_failed']).optional(),
                command: z.string().optional(),
                timeoutSeconds: z.number().int().positive().optional(),
              }),
            )
            .optional(),
          // inline source
          inlineContent: z.string().optional(),
          // github source
          githubUrl: z.string().optional(),
          commitSha: z.string().optional(),
        }),
      )
      .output(WorkflowSchema),
  },

  agents: {
    list: oc
      .input(
        z.object({
          kind: z.enum(['agent', 'skill']).optional(),
          limit: z.number().int().positive().max(100).default(50),
        }).optional(),
      )
      .output(z.array(AgentSchema)),

    get: oc
      .input(z.object({ id: z.string().uuid() }))
      .output(AgentSchema),

    create: oc
      .input(
        z.object({
          kind: z.enum(['agent', 'skill']).default('agent'),
          source: z.enum(['inline', 'github', 'form']),
          // form source
          name: z.string().optional(),
          description: z.string().optional(),
          model: z.string().optional(),
          systemPrompt: z.string().optional(),
          allowedTools: z.array(z.string()).optional(),
          // inline source
          inlineContent: z.string().optional(),
          // github source
          githubUrl: z.string().optional(),
          commitSha: z.string().optional(),
        }),
      )
      .output(AgentSchema),

    delete: oc
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() })),

    listSkills: oc
      .input(z.object({ agentId: z.string().uuid() }))
      .output(z.array(AgentSchema)),

    attachSkill: oc
      .input(z.object({ agentId: z.string().uuid(), skillId: z.string().uuid(), position: z.number().int().default(0) }))
      .output(z.object({ ok: z.boolean() })),

    detachSkill: oc
      .input(z.object({ agentId: z.string().uuid(), skillId: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() })),
  },

  conversations: {
    list: oc
      .input(z.object({ limit: z.number().int().positive().max(100).default(50) }).optional())
      .output(z.array(ConversationSchema)),

    get: oc
      .input(z.object({ id: z.string().uuid() }))
      .output(ConversationSchema),

    create: oc
      .input(z.object({
        title: z.string().min(1),
        defaultGithubUrl: z.string().url().optional(),
        defaultWorkflowId: z.string().uuid().optional(),
      }))
      .output(ConversationSchema),

    update: oc
      .input(z.object({
        id: z.string().uuid(),
        title: z.string().optional(),
        defaultGithubUrl: z.string().url().nullable().optional(),
        defaultWorkflowId: z.string().uuid().nullable().optional(),
        planHoldHours: z.number().int().min(1).max(168).optional(),
      }))
      .output(ConversationSchema),

    delete: oc
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() })),

    sendMessage: oc
      .input(z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1),
        triggersJob: z.boolean().default(true),
        jobOverrides: z.object({
          githubUrl: z.string().url().optional(),
          workflowVersionId: z.string().uuid().optional(),
          title: z.string().optional(),
        }).optional(),
      }))
      .output(z.object({
        messageId: z.string().uuid(),
        jobId: z.string().uuid().nullable(),
      })),

    listMessages: oc
      .input(z.object({
        conversationId: z.string().uuid(),
        limit: z.number().int().positive().max(100).default(20),
        before: z.string().datetime().optional(),
      }))
      .output(z.object({
        messages: z.array(MessageSchema),
        hasMore: z.boolean(),
      })),
  },

  channels: {
    list: oc
      .input(z.object({ conversationId: z.string().uuid() }))
      .output(z.array(ConversationChannelSchema)),

    create: oc
      .input(z.object({
        conversationId: z.string().uuid(),
        type: z.enum(['webhook']),
        name: z.string().min(1),
        config: z.record(z.unknown()),
      }))
      .output(ConversationChannelSchema),

    toggle: oc
      .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
      .output(ConversationChannelSchema),

    delete: oc
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() })),
  },

  memories: {
    listRepos: oc.output(z.array(RepoMemoryListItemSchema)),

    get: oc
      .input(z.object({ repoKey: z.string() }))
      .output(RepoMemorySchema.nullable()),

    update: oc
      .input(z.object({ repoKey: z.string(), content: z.string().min(1) }))
      .output(z.object({ sizeBytes: z.number(), entryCount: z.number() })),

    delete: oc
      .input(z.object({ repoKey: z.string() }))
      .output(z.object({ ok: z.boolean() })),
  },

  plugins: {
    list: oc
      .input(z.object({ conversationId: z.string().uuid() }))
      .output(z.array(PluginSchema)),

    create: oc
      .input(z.object({
        conversationId: z.string().uuid(),
        name: z.string().min(1),
        transport: z.enum(['stdio', 'http']),
        command: z.string().optional(),
        url: z.string().url().optional(),
        env: z.record(z.string()).optional(),
      }))
      .output(PluginSchema),

    toggle: oc
      .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
      .output(PluginSchema),

    delete: oc
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() })),
  },
};

export type Contract = typeof contract;
