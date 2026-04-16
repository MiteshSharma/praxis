import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { PromptBody } from '../dto/agent.dto';

export type { PromptBody };

const activeSessions = new Map<string, AbortController>();

export class AgentService {
  getActiveSessions(): Map<string, AbortController> {
    return activeSessions;
  }

  createSession(sessionId: string): AbortController {
    const abort = new AbortController();
    activeSessions.set(sessionId, abort);
    return abort;
  }

  deleteSession(sessionId: string): void {
    activeSessions.delete(sessionId);
  }

  async runAgent(
    body: PromptBody,
    signal: AbortSignal,
    emit: (chunk: unknown) => Promise<void>,
  ): Promise<void> {
    const apiKey = body.env?.ANTHROPIC_API_KEY ?? '';
    if (apiKey) {
      await this.runClaudeAgent(body, apiKey, signal, emit);
    } else {
      await this.runDemoAgent(body, signal, emit);
    }
  }

  /**
   * Run the real Claude Agent SDK. Loaded lazily so the sandbox-worker boots
   * even when the package is absent.
   */
  private async runClaudeAgent(
    body: PromptBody,
    apiKey: string,
    signal: AbortSignal,
    emit: (chunk: unknown) => Promise<void>,
  ): Promise<void> {
    const { query, createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');

    const userPrompt = [body.title, body.description ?? ''].filter(Boolean).join('\n\n');

    // Build the options object
    const options: Parameters<typeof query>[0]['options'] = {
      cwd: body.workingDir,
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
      abortController: new AbortController(),
      permissionMode: 'bypassPermissions',
      persistSession: false,
      model: body.model ?? 'claude-sonnet-4-6',
    };

    // Override system prompt if provided
    if (body.systemPrompt) {
      options.systemPrompt = body.systemPrompt;
    }

    // Cap turns (used by the learning pass for single-shot generation)
    if (body.maxTurns !== undefined) {
      options.maxTurns = body.maxTurns;
    }

    // Auto-allow specified tools
    if (body.allowedTools?.length) {
      options.allowedTools = body.allowedTools;
    }

    // Wire up the in-process submit_plan MCP tool when we have an MCP token+endpoint
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
              steps: args.steps.map((s) => ({
                ...s,
                status: s.status ?? 'pending',
              })),
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

      // All tools registered on the internal control-plane MCP server.
      // Add new tools here — they are automatically whitelisted below.
      const internalTools = [submitPlanTool];

      options.mcpServers = {
        [INTERNAL_MCP_SERVER]: createSdkMcpServer({
          name: INTERNAL_MCP_SERVER,
          version: '1.0.0',
          tools: internalTools,
        }),
      };

      // bypassPermissions covers built-in tools; in-process MCP tools must be
      // explicitly whitelisted. Derive names from the registered tools array so
      // this list stays in sync automatically as new tools are added.
      const internalToolNames = internalTools.map((t) => `mcp__${INTERNAL_MCP_SERVER}__${t.name}`);
      options.allowedTools = [...(options.allowedTools ?? []), ...internalToolNames];
    }

    // Add conversation plugins (stdio/http MCP servers)
    if (body.plugins?.length) {
      type McpServerConfig = import('@anthropic-ai/claude-agent-sdk').McpStdioServerConfig | import('@anthropic-ai/claude-agent-sdk').McpHttpServerConfig;
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

    const iterator = query({
      prompt: userPrompt,
      options,
    });

    for await (const message of iterator) {
      if (signal.aborted) {
        await iterator.interrupt().catch(() => undefined);
        break;
      }
      await emit(message);
    }
  }

  /**
   * Fallback "demo agent": no LLM call, just a deterministic edit that proves
   * the pipeline end-to-end. Appends a line to README.md (or creates one) in
   * the workspace. Used when ANTHROPIC_API_KEY is not set.
   */
  private async runDemoAgent(
    body: PromptBody,
    _signal: AbortSignal,
    emit: (chunk: unknown) => Promise<void>,
  ): Promise<void> {
    const readme = join(body.workingDir, 'README.md');
    const line = `\n\n<!-- praxis demo agent: ${body.title} -->\n`;

    await emit({ type: 'status', message: 'demo agent: reading README.md' });
    try {
      await readFile(readme, 'utf8');
    } catch {
      await writeFile(readme, `# ${body.title}\n`, 'utf8');
      await emit({ type: 'status', message: 'created README.md' });
    }

    await emit({ type: 'status', message: 'demo agent: appending marker line' });
    await appendFile(readme, line, 'utf8');

    await emit({
      type: 'text-delta',
      text: `Applied a demo change: appended "${body.title}" marker to README.md.`,
    });
  }
}
