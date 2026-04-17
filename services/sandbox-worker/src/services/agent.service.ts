import type { PromptBody } from '../dto/agent.dto';
import { providerRegistry } from '../providers/index.js';

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
    const model = body.model ?? '';
    const env = body.env ?? {};
    const provider = providerRegistry.resolve(model, env);
    await provider.run(body, signal, emit);
  }
}
