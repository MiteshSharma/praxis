import type { PromptBody } from '../dto/agent.dto';
import { providerRegistry } from '../providers/index.js';

export type { PromptBody };

export class AgentService {
  private readonly activeSessions = new Map<string, AbortController>();

  getActiveSessions(): Map<string, AbortController> {
    return this.activeSessions;
  }

  createSession(sessionId: string): AbortController {
    const abort = new AbortController();
    this.activeSessions.set(sessionId, abort);
    return abort;
  }

  deleteSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  async runAgent(
    body: PromptBody,
    signal: AbortSignal,
    emit: (chunk: unknown) => Promise<void>,
  ): Promise<void> {
    const model = body.model ?? '';
    const env = body.env ?? {};
    const provider = providerRegistry.resolve(model, env);
    await provider.run(body, signal, emit);
  }
}
