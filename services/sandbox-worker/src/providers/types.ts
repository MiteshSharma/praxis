import type { PromptBody } from '../dto/agent.dto';

/**
 * Every provider must implement this interface.
 * It receives the parsed request body, an abort signal, and an async emit
 * function to stream normalized SSE messages back to the caller.
 *
 * Normalized SSE message shapes (all providers must emit these):
 *
 *   { type: 'system', model: string, cwd: string }
 *   { type: 'assistant', message: { content: Array<TextBlock | ToolUseBlock> } }
 *   { type: 'user',      message: { content: Array<ToolResultBlock> } }
 *   { type: 'result', subtype: 'success' | 'error_*',
 *       result: string, total_cost_usd: number,
 *       usage: { input_tokens: number, output_tokens: number } }
 *   { type: 'error', error: string }
 *
 * The rest of the system (step-runner, learning pass, UI timeline) consumes
 * only this format — providers must not leak provider-specific shapes.
 */
export interface AgentProvider {
  run(
    body: PromptBody,
    signal: AbortSignal,
    emit: (chunk: unknown) => Promise<void>,
  ): Promise<void>;
}
