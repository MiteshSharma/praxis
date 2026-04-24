export type TaskSourceName = 'web' | 'api' | 'cli' | 'linear' | 'github' | 'slack' | 'schedule';

export interface NormalizedTask {
  source: TaskSourceName;
  externalId?: string;
  externalUrl?: string;
  title: string;
  description?: string | null;
  metadata: Record<string, unknown>;
  triggerKind:
    | 'user_prompt'
    | 'event'
    | 'schedule'
    | 'follow_up'
    | 'restart'
    | 'pr_followup'
    | 'scout';
  githubUrl: string;
  githubBranch?: string;
  workflowId?: string;
  workflowVersionId?: string;
  workflowInputs?: Record<string, unknown>;
  conversationId?: string;
  parentJobId?: string;
  autoApprove?: boolean;
  /** Model override for this job. Null = use system default. */
  model?: string | null;
  /** Job IDs whose output should be injected into this job's execute prompt. */
  contextJobIds?: string[];
  /** When true, a structured report is generated after the job completes. Automatically set for scout jobs. */
  generateReport?: boolean;
}

export interface TaskSource {
  readonly name: TaskSourceName;
  parseWebhook?(raw: unknown, headers: Record<string, string>): Promise<NormalizedTask | null>;
}
