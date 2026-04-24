import { z } from 'zod';
import type { PromptBody } from '../dto/agent.dto';
import { ExecService } from '../services/exec.service.js';
import { registerProvider } from './registry.js';
import { toolRegistry } from './tools/index.js';
import type { AgentProvider } from './types';

/**
 * Claude provider — uses @anthropic-ai/claude-agent-sdk.
 * Supports MCP (mcpToken + mcpEndpoint), plugins, allowedTools, and maxTurns.
 * Emits normalized SSE messages (the SDK's native format matches the contract).
 */
export class ClaudeProvider implements AgentProvider {
  async run(
    body: PromptBody,
    signal: AbortSignal,
    emit: (chunk: unknown) => Promise<void>,
  ): Promise<void> {
    const apiKey = body.env?.ANTHROPIC_API_KEY ?? '';
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for the Claude provider');
    }

    const { query, createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');

    const userPrompt = [body.title, body.description ?? ''].filter(Boolean).join('\n\n');

    const options: Parameters<typeof query>[0]['options'] = {
      cwd: body.workingDir,
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
      abortController: new AbortController(),
      permissionMode: 'bypassPermissions',
      persistSession: false,
      model: body.model ?? 'claude-sonnet-4-6',
    };

    if (body.systemPrompt) options.systemPrompt = body.systemPrompt;
    if (body.maxTurns !== undefined) options.maxTurns = body.maxTurns;
    if (body.allowedTools?.length) options.allowedTools = body.allowedTools;

    // Plan/revise phase: restrict built-in tools to read-only set so that
    // Edit, Write, Bash are not available in the model's context at all.
    const isPlanPhase = body.sessionPhase === 'plan' || body.sessionPhase === 'revise';
    if (isPlanPhase) {
      options.tools = ['Read', 'Glob', 'Grep'];
    }

    // Wire up in-process MCP tools (submit_plan for plan phases, query_memory always)
    if (body.mcpToken && body.mcpEndpoint) {
      const ctx = {
        workingDir: body.workingDir,
        mcpEndpoint: body.mcpEndpoint,
        mcpToken: body.mcpToken,
        exec: new ExecService(),
      };

      const INTERNAL_MCP_SERVER = 'praxis-control-plane';

      const submitPlanSdkTool = isPlanPhase
        ? tool(
            'submit_plan',
            'Submit a structured implementation plan for user review. Call this once you have analysed the codebase and are ready to propose a plan.',
            {
              title: z.string().describe('Short title for the plan'),
              summary: z.string().describe('1–3 sentence summary of the approach'),
              bodyMarkdown: z.string().describe('Full plan body in markdown'),
              steps: z
                .array(
                  z.object({
                    id: z.string().describe('Unique step identifier (e.g. "step-1")'),
                    content: z.string().describe('Description of this step'),
                    status: z.enum(['pending', 'done', 'skipped']).optional(),
                  }),
                )
                .describe('Ordered list of implementation steps'),
              affectedPaths: z
                .array(z.string())
                .describe('File or directory paths that will be changed'),
              risks: z.array(z.string()).optional().describe('Known risks or caveats'),
              openQuestions: z
                .array(
                  z.object({
                    id: z.string(),
                    question: z.string().describe('Question that requires user input'),
                    context: z.string().optional(),
                    options: z.array(z.string()).optional().describe('Suggested answers'),
                    answer: z.string().nullable().optional(),
                  }),
                )
                .optional()
                .describe('Questions for the user before execution begins'),
            },
            async (args) => {
              const normalizedArgs = {
                ...args,
                steps: args.steps.map((s) => ({ ...s, status: s.status ?? 'pending' })),
              };
              const result = await toolRegistry.execute(
                'submit_plan',
                normalizedArgs as Record<string, unknown>,
                ctx,
              );
              const isError =
                result.startsWith('submit_plan failed') || result.startsWith('Error:');
              return {
                content: [{ type: 'text' as const, text: result }],
                ...(isError && { isError: true }),
              };
            },
          )
        : null;

      const queryMemorySdkTool = tool(
        'query_memory',
        "Query the repository's memory for past design decisions, architectural patterns, and conventions. Use this when you need context about how similar problems were solved before or to stay consistent with existing patterns.",
        {
          query: z
            .string()
            .describe('Natural language question about the codebase design or conventions'),
        },
        async (args) => {
          const result = await toolRegistry.execute(
            'query_memory',
            args as Record<string, unknown>,
            ctx,
          );
          const isError = result.startsWith('query_memory failed') || result.startsWith('Error:');
          return {
            content: [{ type: 'text' as const, text: result }],
            ...(isError && { isError: true }),
          };
        },
      );

      const internalTools = [queryMemorySdkTool, ...(submitPlanSdkTool ? [submitPlanSdkTool] : [])];
      options.mcpServers = {
        [INTERNAL_MCP_SERVER]: createSdkMcpServer({
          name: INTERNAL_MCP_SERVER,
          version: '1.0.0',
          tools: internalTools,
        }),
      };
      const internalToolNames = internalTools.map((t) => `mcp__${INTERNAL_MCP_SERVER}__${t.name}`);
      options.allowedTools = [...(options.allowedTools ?? []), ...internalToolNames];
    }

    // Conversation plugins (stdio/http MCP servers)
    if (body.plugins?.length) {
      type McpServerConfig =
        | import('@anthropic-ai/claude-agent-sdk').McpStdioServerConfig
        | import('@anthropic-ai/claude-agent-sdk').McpHttpServerConfig;
      const extraServers: Record<string, McpServerConfig> = {};
      for (const p of body.plugins) {
        if (p.transport === 'stdio' && p.command) {
          const [cmd, ...args] = p.command.split(' ');
          extraServers[p.name] = { type: 'stdio', command: cmd ?? '', args, env: p.env };
        } else if (p.transport === 'http' && p.url) {
          extraServers[p.name] = { type: 'http', url: p.url };
        }
      }
      options.mcpServers = { ...(options.mcpServers ?? {}), ...extraServers };
    }

    const iterator = query({ prompt: userPrompt, options });

    for await (const message of iterator) {
      if (signal.aborted) {
        await iterator.interrupt().catch(() => undefined);
        break;
      }
      await emit(message);
    }
  }
}

registerProvider(
  (model) => model.startsWith('claude-'),
  () => new ClaudeProvider(),
);
