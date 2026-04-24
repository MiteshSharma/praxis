import OpenAI from 'openai';
import type { PromptBody } from '../dto/agent.dto.js';
import { ExecService } from '../services/exec.service.js';
import { registerProvider } from './registry.js';
import { toolRegistry } from './tools/index.js';
import type { Phase, ToolContext } from './tools/index.js';
import type { AgentProvider } from './types.js';

/**
 * OpenRouter provider — routes any model via openrouter.ai's OpenAI-compatible API.
 * Model format in Praxis: `openrouter/<provider>/<model>`
 * e.g. `openrouter/anthropic/claude-opus-4`, `openrouter/google/gemini-2.5-pro`
 */
export class OpenRouterProvider implements AgentProvider {
  async run(
    body: PromptBody,
    signal: AbortSignal,
    emit: (chunk: unknown) => Promise<void>,
  ): Promise<void> {
    const apiKey = body.env?.OPENROUTER_API_KEY ?? '';
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is required for the OpenRouter provider');
    }

    const phase: Phase =
      body.sessionPhase === 'plan' || body.sessionPhase === 'revise'
        ? body.sessionPhase
        : 'execute';

    const ctx: ToolContext = {
      workingDir: body.workingDir,
      mcpEndpoint: body.mcpEndpoint,
      mcpToken: body.mcpToken,
      exec: new ExecService(),
    };

    const availableTools = toolRegistry.getForPhase(phase, ctx);

    const tools: OpenAI.Chat.ChatCompletionTool[] = toolRegistry
      .toFunctionSchema(availableTools)
      .map((def) => ({
        type: 'function',
        function: {
          name: def.name,
          description: def.description,
          parameters: def.parameters as OpenAI.FunctionParameters,
        },
      }));

    // Strip the 'openrouter/' prefix — the actual model name is everything after it
    const model = (body.model ?? 'openrouter/anthropic/claude-opus-4').replace(/^openrouter\//, '');

    const siteUrl = body.env?.OPENROUTER_SITE_URL ?? 'https://github.com/praxis-ai/praxis';
    const siteName = body.env?.OPENROUTER_SITE_NAME ?? 'Praxis';

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': siteUrl,
        'X-Title': siteName,
      },
    });

    await emit({ type: 'system', model: `openrouter/${model}`, cwd: body.workingDir });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (body.systemPrompt) messages.push({ role: 'system', content: body.systemPrompt });
    const userPrompt = [body.title, body.description ?? ''].filter(Boolean).join('\n\n');
    messages.push({ role: 'user', content: userPrompt });

    const maxTurns = body.maxTurns ?? 100;
    let turns = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = '';

    try {
      while (turns < maxTurns) {
        if (signal.aborted) break;
        turns++;

        const response = await client.chat.completions.create({
          model,
          messages,
          ...(tools.length > 0 && { tools, tool_choice: 'auto' }),
        });

        const choice = response.choices[0];
        if (!choice) break;

        inputTokens += response.usage?.prompt_tokens ?? 0;
        outputTokens += response.usage?.completion_tokens ?? 0;

        const msg = choice.message;
        messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam);

        const fnCalls = (msg.tool_calls ?? []).filter(
          (tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => tc.type === 'function',
        );

        await emit({
          type: 'assistant',
          message: {
            content: [
              ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
              ...fnCalls.map((tc) => ({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: parseJson(tc.function.arguments),
              })),
            ],
          },
        });

        if (!fnCalls.length) {
          finalText = msg.content ?? '';
          break;
        }

        for (const tc of fnCalls) {
          const args = parseJson(tc.function.arguments) as Record<string, unknown>;
          const content = await toolRegistry.execute(tc.function.name, args, ctx);
          messages.push({ role: 'tool', tool_call_id: tc.id, content });
          await emit({
            type: 'user',
            message: { content: [{ type: 'tool_result', tool_use_id: tc.id, content }] },
          });
        }
      }

      await emit({
        type: 'result',
        subtype: 'success',
        result: finalText,
        total_cost_usd: 0,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      });
    } catch (err) {
      await emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }
}

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

registerProvider(
  (model) => model.startsWith('openrouter/'),
  () => new OpenRouterProvider(),
);
