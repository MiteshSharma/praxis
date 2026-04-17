import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ExecService } from '../../services/exec.service';

export interface ToolExecutorConfig {
  workingDir: string;
  mcpEndpoint?: string;
  mcpToken?: string;
}

/**
 * Executes tool calls by name + args for non-Claude providers.
 *
 * Mirrors the built-in tools Claude gets from the SDK:
 *   read_file, write_file, edit_file, bash, glob, grep, submit_plan, query_memory
 *
 * submit_plan and query_memory make direct HTTP POSTs to the control-plane MCP
 * endpoint — no MCP SDK involved. Claude uses in-process MCP wiring to reach
 * the same endpoints; this executor calls them directly.
 */
export class ToolExecutor {
  private readonly exec = new ExecService();
  private readonly workingDir: string;
  private readonly mcpEndpoint?: string;
  private readonly mcpToken?: string;

  constructor(config: ToolExecutorConfig) {
    this.workingDir = config.workingDir;
    this.mcpEndpoint = config.mcpEndpoint;
    this.mcpToken = config.mcpToken;
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'read_file':
        return this.readFile(String(args.path));
      case 'write_file':
        return this.writeFile(String(args.path), String(args.content));
      case 'edit_file':
        return this.editFile(String(args.path), String(args.old_string), String(args.new_string));
      case 'bash':
        return this.bash(String(args.command), args.timeout_seconds as number | undefined);
      case 'glob':
        return this.glob(String(args.pattern));
      case 'grep':
        return this.grep(
          String(args.pattern),
          args.path ? String(args.path) : undefined,
          args.glob ? String(args.glob) : undefined,
        );
      case 'submit_plan':
        return this.submitPlan(args);
      case 'query_memory':
        return this.queryMemory(String(args.query));
      default:
        return `Unknown tool: ${name}`;
    }
  }

  private abs(p: string): string {
    return resolve(this.workingDir, p);
  }

  private async readFile(path: string): Promise<string> {
    return readFile(this.abs(path), 'utf-8');
  }

  private async writeFile(path: string, content: string): Promise<string> {
    await writeFile(this.abs(path), content, 'utf-8');
    return `Written ${path}`;
  }

  private async editFile(path: string, oldString: string, newString: string): Promise<string> {
    const absPath = this.abs(path);
    const content = await readFile(absPath, 'utf-8');
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) return `Error: old_string not found in ${path}`;
    if (occurrences > 1) return `Error: old_string is ambiguous — found ${occurrences} times in ${path}`;
    await writeFile(absPath, content.replace(oldString, newString), 'utf-8');
    return `Edited ${path}`;
  }

  private async bash(command: string, timeoutSeconds = 120): Promise<string> {
    const result = await this.exec.run({ command, cwd: this.workingDir, timeoutSeconds });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return result.exitCode === 0 ? output || '(no output)' : `Exit ${result.exitCode}:\n${output}`;
  }

  private async glob(pattern: string): Promise<string> {
    // Use find via bash — avoids a runtime dependency on the glob package
    const result = await this.exec.run({
      command: `find . -type f | grep -E "${pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')}" | sort 2>/dev/null`,
      cwd: this.workingDir,
      timeoutSeconds: 30,
    });
    return result.stdout.trim() || '(no matches)';
  }

  private async grep(pattern: string, path?: string, glob?: string): Promise<string> {
    const target = path ? this.abs(path) : '.';
    const include = glob ? `--include="${glob}"` : '';
    const result = await this.exec.run({
      command: `grep -rn ${include} "${pattern.replace(/"/g, '\\"')}" "${target}" 2>/dev/null | head -100`,
      cwd: this.workingDir,
      timeoutSeconds: 30,
    });
    return result.stdout.trim() || '(no matches)';
  }

  private async submitPlan(args: Record<string, unknown>): Promise<string> {
    if (!this.mcpEndpoint || !this.mcpToken) {
      return 'Error: submit_plan is not available — mcpEndpoint and mcpToken are required';
    }
    const { mcpEndpoint, mcpToken } = this;
    const res = await fetch(`${mcpEndpoint}/submit_plan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${mcpToken}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return `submit_plan failed (${res.status}): ${text}`;
    }
    const data = (await res.json()) as { planId: string; version: number };
    return `Plan submitted. planId=${data.planId} version=${data.version}. Waiting for user review.`;
  }

  private async queryMemory(query: string): Promise<string> {
    if (!this.mcpEndpoint || !this.mcpToken) {
      return 'Error: query_memory is not available — mcpEndpoint and mcpToken are required';
    }
    const res = await fetch(`${this.mcpEndpoint}/query_memory`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.mcpToken}`,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return `query_memory failed (${res.status})`;
    const data = (await res.json()) as { content: string | null; source: string | null; truncated: boolean };
    if (!data.content) return 'No memory found for this repository.';
    const suffix = data.truncated ? `\n\n*(filtered to most relevant chunks — source: ${data.source})*` : '';
    return `${data.content}${suffix}`;
  }
}
