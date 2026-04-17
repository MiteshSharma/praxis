import { z } from 'zod';
import type { PromptBody } from '../dto/agent.dto';
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

    // Wire up the in-process submit_plan MCP tool
    if (body.mcpToken && body.mcpEndpoint) {
      const mcpEndpoint = body.mcpEndpoint;
      const mcpToken = body.mcpToken;
      const INTERNAL_MCP_SERVER = 'praxis-control-plane';

      const submitPlanTool = tool(
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
          const res = await fetch(`${mcpEndpoint}/submit_plan`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${mcpToken}`,
            },
            body: JSON.stringify({
              ...args,
              steps: args.steps.map((s) => ({ ...s, status: s.status ?? 'pending' })),
            }),
          });

          if (!res.ok) {
            const text = await res.text().catch(() => '');
            return {
              content: [{ type: 'text' as const, text: `submit_plan failed (${res.status}): ${text}` }],
              isError: true,
            };
          }

          const data = (await res.json()) as { planId: string; version: number };
          return {
            content: [
              {
                type: 'text' as const,
                text: `Plan submitted successfully. planId=${data.planId} version=${data.version}. The user will review the plan and either approve, revise, or reject it.`,
              },
            ],
          };
        },
      );

      const internalTools = [submitPlanTool];
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
          extraServers[p.name] = { type: 'stdio', command: cmd!, args, env: p.env };
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
