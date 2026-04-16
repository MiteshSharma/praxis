import type { WorkflowDefinition } from '@shared/workflows';

export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  inputs: [{ name: 'prompt', required: true, description: 'What the user wants done' }],
  steps: [
    { kind: 'plan', name: 'Plan the implementation', agent: null },
    { kind: 'execute', name: 'Implement the plan', agent: null },
  ],
};
