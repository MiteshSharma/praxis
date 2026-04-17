import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PromptBody } from '../dto/agent.dto';
import { registerProvider } from './registry.js';
import type { AgentProvider } from './types';

/**
 * Demo provider — no LLM call, deterministic edit for pipeline testing.
 * Used when no API key is present. Appends a marker line to README.md.
 */
export class DemoProvider implements AgentProvider {
  async run(
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
      type: 'result',
      subtype: 'success',
      result: `Applied a demo change: appended "${body.title}" marker to README.md.`,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  }
}

// Catch-all — must be registered last so specific providers match first
registerProvider(
  () => true,
  () => new DemoProvider(),
);

