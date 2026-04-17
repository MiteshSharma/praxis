import type { PromptBody } from '../dto/agent.dto';
import { ClaudeProvider } from '../providers/claude';
import { DemoProvider } from '../providers/demo';
import { OpenAIProvider } from '../providers/openai';
import type { AgentProvider } from '../providers/types';

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
    const provider = this.resolveProvider(body);
    await provider.run(body, signal, emit);
  }

  /**
   * Selects a provider based on the model prefix.
   * Add new providers here as they are implemented.
   */
  private resolveProvider(body: PromptBody): AgentProvider {
    const model = body.model ?? '';

    if (model.startsWith('gpt-') || model.startsWith('codex-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
      return new OpenAIProvider();
    }

    if (model.startsWith('claude-') || body.env?.ANTHROPIC_API_KEY) {
      return new ClaudeProvider();
    }

    // No API key and no recognized model prefix — fall back to demo agent
    return new DemoProvider();
  }
}
