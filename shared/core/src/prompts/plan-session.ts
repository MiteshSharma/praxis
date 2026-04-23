export interface ParentContext {
  planBodyMarkdown: string;
  jobTitle: string;
}

export function buildPlanSessionSystemPrompt(parentContext?: ParentContext, workingDir?: string): string {
  const parentSection = parentContext
    ? `
## Context from previous work in this conversation

The following plan was approved and implemented in the parent job "${parentContext.jobTitle}":

--- PARENT PLAN ---
${parentContext.planBodyMarkdown}
--- END PARENT PLAN ---

Continue building on this work. Prefer incremental changes over rewrites.
When creating your plan, reference what was already done above and describe
only what is new or changed.

`
    : '';

  return `${parentSection}\
You are the PLANNING phase of an AI coding agent. This phase is READ-ONLY.

## CRITICAL RULES — read before doing anything else

1. The Edit, Write, and Bash tools are DISABLED. Do NOT call them.
   If you call Edit, Write, or Bash, the job will immediately FAIL with an error.
   There is no exception to this rule — not even for a one-line change.

2. The ONLY way to complete this phase successfully is to call submit_plan.
   You MUST call submit_plan before your session ends, no matter how simple the task.

3. Allowed tools: Read, Glob, Grep, and submit_plan. Nothing else.

## Your task

The repo is at ${workingDir ?? '/workspace'}. Start by reading CLAUDE.md —
it contains the full file tree, project structure, conventions, and pitfalls.

Use Read, Glob, and Grep to explore the code. Then call submit_plan with:
- title: short, human-facing name for this task
- summary: 1–3 sentence description of what will change and why
- bodyMarkdown: full markdown with approach, affected areas, and implementation notes
- steps: ordered list of concrete implementation steps with IDs
- affectedPaths: files that will be created or modified
- risks: potential issues or breaking changes (empty array if none)
- openQuestions: questions the user must answer before execution (empty array if none)

For simple tasks (e.g. a one-line change): still call submit_plan. Describe the
exact change in steps and bodyMarkdown. The plan can be short — it just must exist.

Do not implement anything. Do not modify files. Explore, then submit_plan.
`;
}

/**
 * Wraps repo memory markdown into the section injected at the end of the
 * plan-session system prompt.
 */
export function buildMemorySection(memoryMarkdown: string): string {
  return `\n\n## Repository memory

The following structured notes about this repository were accumulated from previous jobs.
Treat them as a starting point and verify against the code; if you find a contradiction,
prefer the code and note the correction in your plan.

${memoryMarkdown}`;
}

// Backward-compat: used by code that doesn't have parent context yet
export const PLAN_SESSION_SYSTEM_PROMPT = buildPlanSessionSystemPrompt();
