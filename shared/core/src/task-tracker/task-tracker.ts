import type { OpenQuestion, Plan, PlanData, PlanStep } from '@shared/db';

export type { Plan, PlanData, PlanStep, OpenQuestion };

export type PlanStatus = 'draft' | 'ready' | 'needs_answers' | 'approved' | 'rejected';

export interface PlanDraft {
  title: string;
  summary: string;
  bodyMarkdown: string;
  steps: PlanStep[];
  affectedPaths: string[];
  risks?: string[];
  openQuestions?: OpenQuestion[];
  previousPlanId?: string;
}

export interface RevisionFeedback {
  answers?: Record<string, string>;
  additionalFeedback?: string;
}

/**
 * Seam for plan persistence. The default implementation (`DbTaskTracker`)
 * writes to Postgres. Alternative implementations (e.g. a LinearTaskTracker)
 * can plug in here without touching orchestrator code.
 */
export interface TaskTracker {
  /** Create a new plan version for the job. */
  createPlan(jobId: string, draft: PlanDraft): Promise<Plan>;

  /** Fetch a specific plan by ID. */
  getPlan(planId: string): Promise<Plan | null>;

  /** Fetch the highest-version plan for a job. */
  getLatestPlanForJob(jobId: string): Promise<Plan | null>;

  /** Mark a plan as approved. */
  approvePlan(planId: string): Promise<Plan>;

  /** Mark a plan as rejected (terminal). */
  rejectPlan(planId: string, reason?: string): Promise<Plan>;

  /** Record user revision feedback on a plan and mark it superseded. */
  recordRevisionRequest(planId: string, feedback: RevisionFeedback): Promise<Plan>;

  /** Update a plan's status field. */
  updatePlanStatus(planId: string, status: PlanStatus): Promise<void>;

  /** List all plans for a job, ordered by version asc. */
  listPlansForJob(jobId: string): Promise<Plan[]>;
}
