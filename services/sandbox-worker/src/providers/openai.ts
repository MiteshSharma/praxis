import OpenAI from 'openai';
import type { PromptBody } from '../dto/agent.dto.js';
import { ExecService } from '../services/exec.service.js';
import { registerProvider } from './registry.js';
import { toolRegistry } from './tools/index.js';
import type { Phase, ToolContext } from './tools/index.js';
import type { AgentProvider } from './types.js';

/**
 * OpenAI provider — GPT-4o, o-series, and Codex models.
 * Uses the openai SDK directly with a manual tool-calling loop.
 */
export class OpenAIProvider implements AgentProvider {
  async run(
    body: PromptBody,
    signal: AbortSignal,
    emit: (chunk: unknown) => Promise<void>,
  ): Promise<void> {
    const apiKey = body.env?.OPENAI_API_KEY ?? '';
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for the OpenAI provider');
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

    const model = body.model ?? 'gpt-4o';
    const userPrompt = [body.title, body.description ?? ''].filter(Boolean).join('\n\n');
    const client = new OpenAI({ apiKey });

    await emit({ type: 'system', model, cwd: body.workingDir });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (body.systemPrompt) messages.push({ role: 'system', content: body.systemPrompt });
    messages.push({ role: 'user', content: userPrompt });

    const maxTurns = body.maxTurns ?? 100;
    let turns = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = '';

    // Read-only tools can run in parallel; write tools run sequentially.
    const safeToolNames = new Set(
      availableTools.filter((t) => t.tags.includes('read-only')).map((t) => t.name),
    );

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

        const safeCalls = fnCalls.filter((tc) => safeToolNames.has(tc.function.name));
        const unsafeCalls = fnCalls.filter((tc) => !safeToolNames.has(tc.function.name));

        const executeAndEmit = async (
          tc: OpenAI.Chat.ChatCompletionMessageFunctionToolCall,
        ): Promise<OpenAI.Chat.ChatCompletionToolMessageParam> => {
          const args = parseJson(tc.function.arguments) as Record<string, unknown>;
          const content = await toolRegistry.execute(tc.function.name, args, ctx);
          await emit({
            type: 'user',
            message: { content: [{ type: 'tool_result', tool_use_id: tc.id, content }] },
          });
          return { role: 'tool', tool_call_id: tc.id, content };
        };

        const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [
          ...(await Promise.all(safeCalls.map(executeAndEmit))),
        ];
        for (const tc of unsafeCalls) {
          toolResults.push(await executeAndEmit(tc));
        }

        messages.push(...toolResults);
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
  (model) =>
    model.startsWith('gpt-') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4') ||
    model.startsWith('codex-'),
  () => new OpenAIProvider(),
);
