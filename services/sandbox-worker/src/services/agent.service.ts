import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const userPrompt = [body.title, body.description ?? ''].filter(Boolean).join('\n\n');

    const iterator = query({
      prompt: userPrompt,
      options: {
        cwd: body.workingDir,
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
        abortController: new AbortController(),
      } as Parameters<typeof query>[0]['options'],
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
