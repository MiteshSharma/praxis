import { z } from 'zod';

export const PluginConfigSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http']),
  command: z.string().optional(),
  url: z.string().optional(),
  env: z.record(z.string()).optional(),
});
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export const PromptBodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  jobId: z.string().min(1, 'jobId is required'),
  title: z.string().min(1, 'title is required'),
  description: z.string().nullable().optional(),
  workingDir: z.string().min(1, 'workingDir is required'),
  env: z.record(z.string(), z.string()).optional(),
  /** Model to use — defaults to claude-sonnet-4-6 */
  model: z.string().optional(),
  /** Custom system prompt — overrides the SDK default when provided */
  systemPrompt: z.string().optional(),
  /** Plan/execute/revise phase — informational, used for logging */
  sessionPhase: z.string().optional(),
  /** Additional tools to auto-allow (on top of SDK defaults) */
  allowedTools: z.array(z.string()).optional(),
  /** Short-lived JWT for calling the control-plane MCP endpoint */
  mcpToken: z.string().optional(),
  /** Base URL of the control-plane MCP endpoint (e.g. http://backend:3000/mcp) */
  mcpEndpoint: z.string().optional(),
  /** Conversation-level MCP plugins to wire into the agent session */
  plugins: z.array(PluginConfigSchema).optional(),
  /** Cap the number of agent turns. 1 = single-shot (used by the learning pass). */
  maxTurns: z.number().int().positive().optional(),
});
export type PromptBody = z.infer<typeof PromptBodySchema>;
