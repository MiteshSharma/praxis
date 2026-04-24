import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IExecService } from '../../services/exec.interface.js';

export interface ToolContext {
  workingDir: string;
  mcpEndpoint?: string;
  mcpToken?: string;
  exec: IExecService;
}

export type ToolTag = 'read-only' | 'write' | 'plan' | 'mcp';

export interface Tool<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON Schema for LLM function calling */
  schema: Record<string, unknown>;
  tags: ReadonlyArray<ToolTag>;
  isAvailable?(ctx: ToolContext): boolean;
  execute(args: TArgs, ctx: ToolContext): Promise<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function abs(workingDir: string, p: string): string {
  return resolve(workingDir, p);
}

// ---------------------------------------------------------------------------
// Read-only tools
// ---------------------------------------------------------------------------

export const readFileTool: Tool<{ path: string }> = {
  name: 'read_file',
  description: 'Read the full contents of a file.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
    },
    required: ['path'],
  },
  tags: ['read-only'],
  async execute({ path }, ctx) {
    return readFile(abs(ctx.workingDir, path), 'utf-8');
  },
};

export const globTool: Tool<{ pattern: string }> = {
  name: 'glob',
  description: 'Find files in the workspace matching a glob pattern, e.g. "src/**/*.ts".',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
    },
    required: ['pattern'],
  },
  tags: ['read-only'],
  async execute({ pattern }, ctx) {
    const result = await ctx.exec.run({
      command: `find . -type f | grep -E "${pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')}" | sort 2>/dev/null`,
      cwd: ctx.workingDir,
      timeoutSeconds: 30,
    });
    return result.stdout.trim() || '(no matches)';
  },
};

export const grepTool: Tool<{ pattern: string; path?: string; glob?: string }> = {
  name: 'grep',
  description: 'Search for a regex pattern across files in the workspace.',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: {
        type: 'string',
        description: 'Directory or file to search in (default: workspace root)',
      },
      glob: { type: 'string', description: 'File glob filter, e.g. "*.ts"' },
    },
    required: ['pattern'],
  },
  tags: ['read-only'],
  async execute({ pattern, path, glob }, ctx) {
    const target = path ? abs(ctx.workingDir, path) : '.';
    const include = glob ? `--include="${glob}"` : '';
    const result = await ctx.exec.run({
      command: `grep -rn ${include} "${pattern.replace(/"/g, '\\"')}" "${target}" 2>/dev/null | head -100`,
      cwd: ctx.workingDir,
      timeoutSeconds: 30,
    });
    return result.stdout.trim() || '(no matches)';
  },
};

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

export const writeFileTool: Tool<{ path: string; content: string }> = {
  name: 'write_file',
  description: 'Write content to a file, creating it if it does not exist.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to write to' },
      content: { type: 'string', description: 'Full file content' },
    },
    required: ['path', 'content'],
  },
  tags: ['write'],
  async execute({ path, content }, ctx) {
    const absPath = abs(ctx.workingDir, path);
    let isNew = false;
    try {
      await access(absPath);
    } catch {
      isNew = true;
    }
    await writeFile(absPath, content, 'utf-8');
    return JSON.stringify({ path, status: isNew ? 'added' : 'modified' });
  },
};

export const editFileTool: Tool<{ path: string; old_string: string; new_string: string }> = {
  name: 'edit_file',
  description:
    'Replace an exact string in a file. The old_string must appear exactly once — returns an error if not found or ambiguous.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      old_string: {
        type: 'string',
        description: 'Exact content to replace (must be unique in the file)',
      },
      new_string: { type: 'string', description: 'Replacement content' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  tags: ['write'],
  async execute({ path, old_string, new_string }, ctx) {
    const absPath = abs(ctx.workingDir, path);
    const content = await readFile(absPath, 'utf-8');
    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) return `Error: old_string not found in ${path}`;
    if (occurrences > 1)
      return `Error: old_string is ambiguous — found ${occurrences} times in ${path}`;
    await writeFile(absPath, content.replace(old_string, new_string), 'utf-8');
    return JSON.stringify({ path, status: 'modified' });
  },
};

export const bashTool: Tool<{ command: string; timeout_seconds?: number }> = {
  name: 'bash',
  description: 'Run a shell command in the workspace root.',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeout_seconds: {
        type: 'number',
        description: 'Max execution time in seconds (default 120)',
      },
    },
    required: ['command'],
  },
  tags: ['write'],
  async execute({ command, timeout_seconds = 120 }, ctx) {
    const result = await ctx.exec.run({
      command,
      cwd: ctx.workingDir,
      timeoutSeconds: timeout_seconds,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return result.exitCode === 0 ? output || '(no output)' : `Exit ${result.exitCode}:\n${output}`;
  },
};

// ---------------------------------------------------------------------------
// Plan tools
// ---------------------------------------------------------------------------

export const submitPlanTool: Tool<Record<string, unknown>> = {
  name: 'submit_plan',
  description:
    'Submit a structured implementation plan for user review. Call this once you have analysed the codebase and are ready to propose a plan.',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the plan' },
      summary: { type: 'string', description: '1–3 sentence summary of the approach' },
      bodyMarkdown: { type: 'string', description: 'Full plan body in markdown' },
      steps: {
        type: 'array',
        description: 'Ordered list of implementation steps',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'done', 'skipped'] },
          },
          required: ['id', 'content'],
        },
      },
      affectedPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'File or directory paths that will be changed',
      },
      risks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Known risks or caveats',
      },
      openQuestions: {
        type: 'array',
        description: 'Questions for the user before execution begins',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            question: { type: 'string' },
            context: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string', nullable: true },
          },
          required: ['id', 'question'],
        },
      },
    },
    required: ['title', 'summary', 'bodyMarkdown', 'steps', 'affectedPaths'],
  },
  tags: ['plan'],
  isAvailable(ctx) {
    return !!(ctx.mcpEndpoint && ctx.mcpToken);
  },
  async execute(args, ctx) {
    if (!ctx.mcpEndpoint || !ctx.mcpToken) {
      return 'Error: submit_plan is not available — mcpEndpoint and mcpToken are required';
    }
    const res = await fetch(`${ctx.mcpEndpoint}/submit_plan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.mcpToken}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return `submit_plan failed (${res.status}): ${text}`;
    }
    const data = (await res.json()) as { planId: string; version: number };
    return `Plan submitted. planId=${data.planId} version=${data.version}. Waiting for user review.`;
  },
};

// ---------------------------------------------------------------------------
// MCP tools
// ---------------------------------------------------------------------------

export const queryMemoryTool: Tool<{ query: string }> = {
  name: 'query_memory',
  description:
    "Query the repository's memory for past design decisions, architectural patterns, and " +
    'conventions. Use this when you need context about how similar problems were solved ' +
    'before or to stay consistent with existing patterns.',
  schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language question about the codebase design or conventions',
      },
    },
    required: ['query'],
  },
  tags: ['mcp', 'read-only'],
  isAvailable(ctx) {
    return !!(ctx.mcpEndpoint && ctx.mcpToken);
  },
  async execute({ query }, ctx) {
    if (!ctx.mcpEndpoint || !ctx.mcpToken) {
      return 'Error: query_memory is not available — mcpEndpoint and mcpToken are required';
    }
    const res = await fetch(`${ctx.mcpEndpoint}/query_memory`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.mcpToken}`,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return `query_memory failed (${res.status})`;
    const data = (await res.json()) as {
      content: string | null;
      source: string | null;
      truncated: boolean;
    };
    if (!data.content) return 'No memory found for this repository.';
    const suffix = data.truncated
      ? `\n\n*(filtered to most relevant chunks — source: ${data.source})*`
      : '';
    return `${data.content}${suffix}`;
  },
};
