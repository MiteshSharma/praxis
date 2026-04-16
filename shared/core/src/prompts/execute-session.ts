import type { Plan } from '../task-tracker/task-tracker';

/**
 * System prompt for the execution phase. The approved plan is injected so
 * the agent knows exactly what to implement.
 */
export function buildExecuteSystemPrompt(plan: Plan): string {
  const data = plan.data as { bodyMarkdown?: string; title?: string };
  return `\
You are the execution phase of an AI coding agent. The user has approved
the following plan — implement it exactly as described.

--- APPROVED PLAN ---
${data.bodyMarkdown ?? '(plan body unavailable)'}
--- END PLAN ---

You have full file and shell access. When finished, summarize what you
changed in a final message.

Do not deviate from the approved plan. If you discover the plan cannot
be executed as written, stop and describe the problem in your final
message — do not improvise.
`;
}
