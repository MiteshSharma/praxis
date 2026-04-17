import type { PromptBody } from '../dto/agent.dto';
import type { AgentProvider } from './types';

/**
 * OpenAI provider — Codex / GPT-4o / o-series models.
 *
 * NOT YET IMPLEMENTED. Use a claude-* model.
 *
 * ── Implementation guide ──────────────────────────────────────────────────
 *
 * Infrastructure already in place:
 *   providers/tools/definitions.ts  — FILE_TOOLS + PLAN_TOOLS in OpenAI schema format
 *   providers/tools/executor.ts     — ToolExecutor: executes read_file, write_file,
 *                                     edit_file, bash, glob, grep, submit_plan
 *
 * Steps to implement:
 *
 * 1. Build the tool list:
 *      const tools = [...FILE_TOOLS, ...(hasMcp ? PLAN_TOOLS : [])];
 *      // convert ToolDefinition[] to OpenAI ChatCompletionTool[] format
 *
 * 2. Tool loop (POST /v1/chat/completions or /v1/responses):
 *      while (true) {
 *        const response = await openai.chat.completions.create({ model, messages, tools });
 *        emit normalized assistant message
 *        if no tool_calls → break
 *        for each tool_call:
 *          const result = await executor.execute(name, args)
 *          emit normalized user message (tool result)
 *          append to messages
 *      }
 *
 * 3. Emit final result message:
 *      emit({
 *        type: 'result', subtype: 'success',
 *        result: lastTextContent,
 *        total_cost_usd: 0,   // OpenAI doesn't return cost in-response
 *        usage: {
 *          input_tokens: response.usage.prompt_tokens,
 *          output_tokens: response.usage.completion_tokens,
 *        },
 *      });
 *
 * 4. API key: body.env?.OPENAI_API_KEY
 *
 * 5. MCP / plugins: not supported for this provider — ignored.
 *    submit_plan is handled by ToolExecutor via direct HTTP (no MCP needed).
 * ──────────────────────────────────────────────────────────────────────────
 */
export class OpenAIProvider implements AgentProvider {
  async run(
    _body: PromptBody,
    _signal: AbortSignal,
    _emit: (chunk: unknown) => Promise<void>,
  ): Promise<void> {
    throw new Error(
      'OpenAI provider is not yet implemented. Use a claude-* model instead.',
    );
  }
}
