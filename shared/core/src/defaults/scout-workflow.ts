import type { WorkflowDefinition } from '@shared/workflows';

/**
 * Workflow used for scout (read-only) jobs.
 * Single scout step — no plan review gate, no publish step.
 * The agent reads the codebase and produces a structured findings report.
 */
export const SCOUT_WORKFLOW: WorkflowDefinition = {
  inputs: [{ name: 'prompt', required: true, description: 'What to investigate' }],
  steps: [
    { kind: 'scout', name: 'Investigate codebase', agent: null },
  ],
};
