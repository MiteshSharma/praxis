export type TaskSourceName = 'web' | 'api' | 'cli' | 'linear' | 'github' | 'slack' | 'schedule';

export interface NormalizedTask {
  source: TaskSourceName;
  externalId?: string;
  externalUrl?: string;
  title: string;
  description?: string | null;
  metadata: Record<string, unknown>;
  triggerKind: 'user_prompt' | 'event' | 'schedule' | 'follow_up' | 'restart';
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
}

export interface TaskSource {
  readonly name: TaskSourceName;
  parseWebhook?(raw: unknown, headers: Record<string, string>): Promise<NormalizedTask | null>;
}
