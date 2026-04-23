/**
 * Named tool sets for workflow step configuration.
 *
 * Instead of listing individual tool names in `allowedTools`, workflow authors
 * can specify `toolSets` to enable a logical group. Adding a new built-in tool
 * only requires updating the relevant set here — all workflows using that set
 * pick it up automatically.
 */
export const TOOL_SETS = {
  file:   ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  shell:  ['Bash'],
  memory: ['query_memory'],
  plan:   ['submit_plan'],
} as const;

export type ToolSetName = keyof typeof TOOL_SETS;

/**
 * Expand a list of tool-set names into individual tool strings.
 * Deduplicates and merges with any explicitly-listed allowedTools.
 */
export function expandToolSets(
  toolSets: ToolSetName[],
  allowedTools: string[] = [],
): string[] {
  const expanded = toolSets.flatMap((name) => [...TOOL_SETS[name]]);
  return [...new Set([...expanded, ...allowedTools])];
}
