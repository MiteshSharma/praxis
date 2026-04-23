import type { Plan } from '../task-tracker/task-tracker';

/**
 * System prompt for the execution phase. The approved plan is injected so
 * the agent knows exactly what to implement.
 */
export function buildExecuteSystemPrompt(plan: Plan, workingDir?: string): string {
  const data = plan.data as { bodyMarkdown?: string; title?: string };
  return `\
You are the execution phase of an AI coding agent. The user has approved
the following plan — implement it exactly as described.

The repo is at ${workingDir ?? '/workspace'}. Read CLAUDE.md there — it has the
full file tree and conventions so you can go straight to the relevant files.

--- APPROVED PLAN ---
${data.bodyMarkdown ?? '(plan body unavailable)'}
--- END PLAN ---

You have full file and shell access. When finished, summarize what you
changed in a final message.

Do not deviate from the approved plan. If you discover the plan cannot
be executed as written, stop and describe the problem in your final
message — do not improvise.

---
As you work, if you observe something repo-specific that future jobs would benefit
from knowing (a non-obvious convention, an architectural decision, a tech debt item),
add a brief comment in the form:
  <!-- PRAXIS_MEMORY: <observation> -->
anywhere in your response. The learning pass will incorporate it into MEMORY.md.
`;
}
