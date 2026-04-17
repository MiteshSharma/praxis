/**
 * Provider-agnostic tool definitions in OpenAI function-calling schema format.
 *
 * Claude gets these tools for free from the SDK (Read, Edit, Bash, etc.).
 * For OpenAI and other providers, use these definitions to build the function
 * list and ToolExecutor to execute the calls.
 *
 * Split into FILE_TOOLS (always available) and PLAN_TOOLS (plan phase only,
 * requires mcpEndpoint + mcpToken to be configured).
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export const FILE_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the full contents of a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if it does not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to write to' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact string in a file. The old_string must appear exactly once — returns an error if not found or ambiguous.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
        old_string: { type: 'string', description: 'Exact content to replace (must be unique in the file)' },
        new_string: { type: 'string', description: 'Replacement content' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'bash',
    description: 'Run a shell command in the workspace root.',
    parameters: {
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
  },
  {
    name: 'glob',
    description: 'Find files in the workspace matching a glob pattern, e.g. "src/**/*.ts".',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search for a regex pattern across files in the workspace.',
    parameters: {
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
  },
];

export const MEMORY_TOOLS: ToolDefinition[] = [
  {
    name: 'query_memory',
    description:
      "Query the repository's memory for past design decisions, architectural patterns, and " +
      'conventions. Use this when you need context about how similar problems were solved ' +
      'before or to stay consistent with existing patterns.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language question about the codebase design or conventions',
        },
      },
      required: ['query'],
    },
  },
];

export const PLAN_TOOLS: ToolDefinition[] = [
  {
    name: 'submit_plan',
    description:
      'Submit a structured implementation plan for user review. Call this once you have analysed the codebase and are ready to propose a plan.',
    parameters: {
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
  },
];
