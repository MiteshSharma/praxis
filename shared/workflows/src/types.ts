import { z } from 'zod';

// ── Agent definition ─────────────────────────────────────────────────────────

export const AgentRefSchema = z.discriminatedUnion('ref', [
  z.object({ ref: z.literal('github'), url: z.string(), commitSha: z.string().optional() }),
  z.object({ ref: z.literal('id'), agentId: z.string().uuid(), agentVersionId: z.string().uuid().optional() }),
]);
export type AgentRef = z.infer<typeof AgentRefSchema>;

export const AgentDefinitionSchema = z.object({
  model: z.string().default('claude-sonnet-4-5-20250929'),
  systemPrompt: z.string(),
  allowedTools: z.array(z.string()).default([]),
  // Skills only: agent IDs whose prompts should be loaded as base context when this skill is used standalone
  dependsOn: z.array(z.string().uuid()).optional(),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

// ── Workflow step definitions ─────────────────────────────────────────────────

export const PlanStepDefSchema = z.object({
  kind: z.literal('plan'),
  name: z.string(),
  agent: AgentRefSchema.optional().nullable(),
  // Skill used as the primary agent for this step (equivalent to agent)
  skillId: z.string().uuid().optional(),
});

export const ExecuteStepDefSchema = z.object({
  kind: z.literal('execute'),
  name: z.string(),
  agent: AgentRefSchema.optional().nullable(),
  // Skill used as the primary agent for this step (equivalent to agent)
  skillId: z.string().uuid().optional(),
  condition: z.enum(['previous_check_failed']).optional(),
});

export const CheckStepDefSchema = z.object({
  kind: z.literal('check'),
  name: z.string(),
  command: z.string(),
  timeoutSeconds: z.number().int().positive().default(300),
  capture: z.enum(['stdout', 'stderr', 'both']).default('both'),
});

export const WorkflowStepDefSchema = z.discriminatedUnion('kind', [
  PlanStepDefSchema,
  ExecuteStepDefSchema,
  CheckStepDefSchema,
]);
export type WorkflowStepDef = z.infer<typeof WorkflowStepDefSchema>;

// ── Workflow definition ───────────────────────────────────────────────────────

export const WorkflowInputSchema = z.object({
  name: z.string(),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.string().optional(),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export const WorkflowDefinitionSchema = z.object({
  inputs: z.array(WorkflowInputSchema).optional(),
  steps: z.array(WorkflowStepDefSchema).min(1),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ── Parsed document (agent or workflow) ──────────────────────────────────────

export const AgentDocSchema = z.object({
  kind: z.literal('agent'),
  name: z.string(),
  description: z.string().default(''),
  version: z.string().default('1.0.0'),
  agent: AgentDefinitionSchema,
});

export const WorkflowDocSchema = z.object({
  kind: z.literal('workflow'),
  name: z.string(),
  description: z.string().default(''),
  version: z.string().default('1.0.0'),
  workflow: WorkflowDefinitionSchema,
});

export const DefinitionSchema = z.discriminatedUnion('kind', [AgentDocSchema, WorkflowDocSchema]);
export type Definition = z.infer<typeof DefinitionSchema>;
export type AgentDoc = z.infer<typeof AgentDocSchema>;
export type WorkflowDoc = z.infer<typeof WorkflowDocSchema>;
