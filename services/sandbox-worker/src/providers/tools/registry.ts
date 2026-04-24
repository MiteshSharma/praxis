import type { Tool, ToolContext } from './definitions.js';

export type Phase = 'plan' | 'revise' | 'execute';

/**
 * Registry of all available tools.
 *
 * getForPhase() returns the tools appropriate for a given execution phase:
 *   plan/revise — read-only tools + plan tools (no write tools)
 *   execute     — read-only + write tools (no plan tools)
 *
 * Tools with isAvailable() are filtered against the provided context.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  getForPhase(phase: Phase, ctx: ToolContext): Tool[] {
    const isPlan = phase === 'plan' || phase === 'revise';
    return Array.from(this.tools.values()).filter((tool) => {
      if (tool.isAvailable && !tool.isAvailable(ctx)) return false;
      if (isPlan) {
        // Plan phase: read-only and plan tools only (no 'write')
        return tool.tags.includes('read-only') || tool.tags.includes('plan');
      }
      // Execute phase: everything except plan-specific tools
      return !tool.tags.includes('plan');
    });
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Unknown tool: ${name}`;
    return tool.execute(args, ctx);
  }

  /** Convert tools to OpenAI function-calling schema format. */
  toFunctionSchema(
    tools: Tool[],
  ): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.schema,
    }));
  }
}
