import type { AgentDefinition } from '@shared/workflows';

/**
 * Read-only agent used for scout steps.
 * Write tools (Write, Edit) are intentionally absent — the scout must not modify files.
 * Bash is included for read-only shell commands (ls, cat, git log, grep, find, etc.).
 */
export const SCOUT_AGENT: AgentDefinition = {
  model: 'claude-sonnet-4-6', // used only if step config and job.model are both absent
  systemPrompt: '', // overridden by buildScoutSystemPrompt at runtime
  allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
};
