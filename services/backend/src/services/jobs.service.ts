import { ORPCError } from '@orpc/server';
import type { ArtifactDto, JobDto, JobStatus, JobStepDto, PrReviewComment, ReviewCommentDto, TimelineEventDto } from '@shared/contracts';
import { JOB_EXECUTE_QUEUE, TaskIngestService, appendTimeline, splitWebInput } from '@shared/core';
import { type Database, artifacts, jobTimeline, jobs, messages, plans, sandboxes } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { Octokit } from '@octokit/rest';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { JobsRepository, toJobDto } from '../repositories/jobs.repository';
import { SessionsRepository } from '../repositories/sessions.repository';
import { WorkflowsRepository } from '../repositories/workflows.repository';

const TERMINAL_JOB_STATUSES: JobStatus[] = ['completed', 'plan_rejected', 'failed', 'cancelled'];

interface CreateFromSessionInput {
  sessionId: string;
  task: string;
  githubUrl?: string;
  workflowId?: string;
  autoApprove?: boolean;
}

/**
 * Backend-local jobs service — the thin glue between the routes layer and
 * the role-neutral `@shared/core` ingress. Route handlers stay simple: parse,
 * call this, reply.
 */
export class JobsService {
  private readonly ingest: TaskIngestService;
  private readonly repo: JobsRepository;
  private readonly sessionsRepo: SessionsRepository;
  private readonly workflowsRepo: WorkflowsRepository;

  constructor(
    private readonly db: Database,
    private readonly boss: PgBoss,
    log: Logger,
    overrides?: {
      ingest?: TaskIngestService;
      repo?: JobsRepository;
      sessionsRepo?: SessionsRepository;
      workflowsRepo?: WorkflowsRepository;
    },
  ) {
    this.ingest = overrides?.ingest ?? new TaskIngestService(db, boss, log);
    this.repo = overrides?.repo ?? new JobsRepository(db);
    this.sessionsRepo = overrides?.sessionsRepo ?? new SessionsRepository(db);
    this.workflowsRepo = overrides?.workflowsRepo ?? new WorkflowsRepository(db);
  }

  async create(input: CreateFromSessionInput): Promise<JobDto> {
    const session = await this.sessionsRepo.findById(input.sessionId);
    if (!session) throw new ORPCError('NOT_FOUND', { message: 'session not found' });

    const githubUrl = input.githubUrl ?? session.defaultGithubUrl;
    if (!githubUrl) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'no githubUrl provided and session has no default githubUrl',
      });
    }

    const parentJobId = await this.sessionsRepo.findLastCompletedJobId(input.sessionId);
    const { title, description } = splitWebInput(input.task);

    const resolvedWorkflowId = input.workflowId ?? session.defaultWorkflowId ?? null;
    const workflowVersionId = resolvedWorkflowId
      ? await this.workflowsRepo.findLatestVersionId(resolvedWorkflowId)
      : undefined;

    const userMsg = await this.sessionsRepo.insertMessage({
      sessionId: input.sessionId,
      role: 'user',
      content: input.task,
    });

    const { id: jobId } = await this.ingest.ingest({
      source: 'web',
      triggerKind: 'user_prompt',
      title,
      description,
      metadata: {},
      githubUrl,
      githubBranch: 'main',
      conversationId: input.sessionId,
      parentJobId: parentJobId ?? undefined,
      workflowVersionId,
      model: session.model ?? null,
      autoApprove: input.autoApprove ?? false,
    });

    await this.sessionsRepo.updateMessageJobId(userMsg.id, jobId);

    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'job not found after creation' });
    return toJobDto(row);
  }

  async getById(jobId: string): Promise<JobDto> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    return toJobDto(row);
  }

  async list(
    limit = 50,
    filters?: { sessionId?: string; status?: JobStatus },
  ): Promise<JobDto[]> {
    return this.repo.findMany(limit, filters);
  }

  async listArtifacts(jobId: string): Promise<ArtifactDto[]> {
    return this.repo.findArtifactsByJobId(jobId);
  }

  async listSteps(jobId: string): Promise<JobStepDto[]> {
    return this.repo.findStepsByJobId(jobId);
  }

  async cancel(jobId: string): Promise<void> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    if (TERMINAL_JOB_STATUSES.includes(row.status as JobStatus)) {
      throw new ORPCError('BAD_REQUEST', { message: 'job is already in a terminal state' });
    }

    await this.db
      .update(jobs)
      .set({
        status: 'cancelled',
        errorMessage: 'Cancelled by user',
        errorCategory: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    await appendTimeline(this.db, jobId, 'status-changed', { from: row.status, to: 'cancelled' });

    // Signal the sandbox to stop immediately if one is active for this job.
    const [sandbox] = await this.db
      .select({ endpoint: sandboxes.endpoint })
      .from(sandboxes)
      .where(eq(sandboxes.jobId, jobId))
      .limit(1);

    if (sandbox?.endpoint) {
      fetch(`${sandbox.endpoint}/abort`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: jobId }),
      }).catch(() => {
        // Best-effort — sandbox may already be gone
      });
    }
  }

  async delete(jobId: string): Promise<void> {
    await this.repo.delete(jobId);
  }

  async resumeFromPlan(jobId: string): Promise<{ jobId: string }> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    if (row.status !== 'failed') {
      throw new ORPCError('BAD_REQUEST', { message: 'only failed jobs can be resumed from a plan checkpoint' });
    }

    const plan = await this.db.query.plans.findFirst({
      where: and(eq(plans.jobId, jobId), eq(plans.status, 'approved')),
    });
    if (!plan) {
      throw new ORPCError('BAD_REQUEST', { message: 'no approved plan found — use Restart to run from scratch' });
    }

    await this.db.update(jobs).set({ status: 'queued', updatedAt: new Date() }).where(eq(jobs.id, jobId));
    await this.boss.send(JOB_EXECUTE_QUEUE, { jobId });
    return { jobId };
  }

  async getTimeline(
    jobId: string,
    limit = 200,
    cursor?: number,
  ): Promise<{ events: TimelineEventDto[]; hasMore: boolean; nextCursor?: number }> {
    const rows = await this.db
      .select()
      .from(jobTimeline)
      .where(cursor !== undefined ? and(eq(jobTimeline.jobId, jobId), gt(jobTimeline.seq, cursor)) : eq(jobTimeline.jobId, jobId))
      .orderBy(asc(jobTimeline.seq))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map((r) => ({
      seq: r.seq,
      type: r.type,
      payload: r.payload as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      events,
      hasMore,
      nextCursor: hasMore ? events[events.length - 1]?.seq : undefined,
    };
  }

  async getReviewComments(jobId: string): Promise<ReviewCommentDto[]> {
    const githubToken = process.env.GITHUB_TOKEN ?? '';
    if (!githubToken) throw new ORPCError('BAD_REQUEST', { message: 'GITHUB_TOKEN not configured' });

    const artifact = await this.db.query.artifacts.findFirst({
      where: and(eq(artifacts.jobId, jobId), eq(artifacts.kind, 'pr')),
      orderBy: desc(artifacts.createdAt),
    });
    if (!artifact?.url) throw new ORPCError('NOT_FOUND', { message: 'no PR artifact found for this job' });

    const meta = artifact.metadata as { prNumber?: number; repoUrl?: string };
    if (!meta.prNumber || !meta.repoUrl) {
      throw new ORPCError('BAD_REQUEST', { message: 'PR metadata incomplete' });
    }

    const match = meta.repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/);
    if (!match) throw new ORPCError('BAD_REQUEST', { message: 'cannot parse repoUrl' });
    const [, owner, repo] = match;

    const octokit = new Octokit({ auth: githubToken });

    const [reviewComments, issueComments] = await Promise.all([
      octokit.pulls.listReviewComments({ owner, repo, pull_number: meta.prNumber, per_page: 100 }),
      octokit.issues.listComments({ owner, repo, issue_number: meta.prNumber, per_page: 100 }),
    ]);

    const result: ReviewCommentDto[] = [
      ...reviewComments.data.map((c) => ({
        id: c.id,
        body: c.body,
        path: c.path ?? null,
        line: c.line ?? c.original_line ?? null,
        user: c.user?.login ?? null,
        createdAt: c.created_at,
      })),
      ...issueComments.data.map((c) => ({
        id: c.id,
        body: c.body ?? '',
        path: null,
        line: null,
        user: c.user?.login ?? null,
        createdAt: c.created_at,
      })),
    ];

    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * UI path (approach B): user types a task and submits from the job detail page.
   * Looks up the PR artifact from the job and delegates to the shared core.
   */
  async createFollowup(jobId: string, task: string): Promise<{ jobId: string }> {
    const original = await this.repo.findById(jobId);
    if (!original) throw new ORPCError('NOT_FOUND', { message: 'job not found' });
    if (original.status !== 'completed') {
      throw new ORPCError('BAD_REQUEST', { message: 'can only create follow-ups on completed jobs' });
    }

    const prArtifact = await this.db.query.artifacts.findFirst({
      where: and(eq(artifacts.jobId, jobId), eq(artifacts.kind, 'pr')),
      orderBy: desc(artifacts.createdAt),
    });
    if (!prArtifact) throw new ORPCError('BAD_REQUEST', { message: 'no PR artifact found — job has no open PR' });

    const meta = prArtifact.metadata as { branchName?: string; prNumber?: number };
    if (!meta.branchName) throw new ORPCError('BAD_REQUEST', { message: 'PR artifact missing branchName' });

    return this._createFollowupJob(jobId, meta.branchName, task, []);
  }

  /**
   * Webhook path (approach A): called by the GitHub webhook handler when a
   * pull_request_review event fires with state=changes_requested.
   *
   * The caller supplies the PR branch name (from the webhook payload) and the
   * pre-parsed review comments. This method resolves the job via reverse lookup
   * and delegates to the shared core.
   *
   * Wire-up (approach A):
   *   POST /webhooks/github/:token
   *     → parse payload
   *     → jobsService.createFollowupFromReview(prBranch, comments, review.body)
   *   OR via channel dispatch:
   *     dispatchToConversation(db, conversationId, { type: 'pr.review_requested', ... })
   *     → channel.onPrReviewRequested() calls this method
   */
  async createFollowupFromReview(
    prBranch: string,
    comments: PrReviewComment[],
    reviewNote?: string | null,
  ): Promise<{ jobId: string }> {
    const original = await this.repo.findByPrBranch(prBranch);
    if (!original) throw new ORPCError('NOT_FOUND', { message: `no job found for PR branch: ${prBranch}` });
    if (original.status !== 'completed') {
      throw new ORPCError('BAD_REQUEST', { message: 'job is not yet completed' });
    }

    const task = buildTaskFromComments(comments, reviewNote);
    return this._createFollowupJob(original.id, prBranch, task, comments);
  }

  /**
   * Shared core: creates a follow-up job on an existing PR branch with the
   * original plan injected as context. Called by both approach B (UI) and
   * approach A (webhook).
   */
  private async _createFollowupJob(
    jobId: string,
    prBranch: string,
    task: string,
    comments: PrReviewComment[],
  ): Promise<{ jobId: string }> {
    const original = await this.repo.findById(jobId);
    if (!original) throw new ORPCError('NOT_FOUND', { message: 'job not found' });

    const plan = await this.db.query.plans.findFirst({
      where: and(eq(plans.jobId, jobId), eq(plans.status, 'approved')),
      orderBy: desc(plans.version),
    });

    const taskWithContext = plan
      ? `${task}\n\n---\nOriginal plan context:\n${plan.data.summary}\n\nOriginal steps:\n${(plan.data as { steps?: Array<{ content: string }> }).steps?.map((s) => `- ${s.content}`).join('\n') ?? ''}`
      : task;

    const { id } = await this.ingest.ingest({
      source: 'web',
      triggerKind: 'pr_followup',
      title: task.slice(0, 120),
      description: taskWithContext,
      metadata: { prFollowupBranch: prBranch, parentJobId: jobId, commentCount: comments.length },
      githubUrl: original.githubUrl,
      githubBranch: original.githubBranch,
      conversationId: original.conversationId ?? undefined,
      parentJobId: jobId,
      workflowVersionId: original.workflowVersionId ?? undefined,
      model: original.model ?? null,
      autoApprove: original.autoApprove,
    });

    return { jobId: id };
  }

  async restart(jobId: string): Promise<{ jobId: string }> {
    const original = await this.repo.findById(jobId);
    if (!original) throw new ORPCError('NOT_FOUND', { message: 'job not found' });

    const { id } = await this.ingest.ingest({
      source: 'web',
      triggerKind: 'restart',
      title: original.title,
      description: original.description ?? undefined,
      metadata: { restartedFromJobId: original.id },
      githubUrl: original.githubUrl,
      githubBranch: original.githubBranch,
      workflowVersionId: original.workflowVersionId ?? undefined,
      conversationId: original.conversationId ?? undefined,
    });

    // Re-point any conversation messages that referenced the old job to the new one,
    // so the conversation thread shows the latest run instead of the failed one.
    if (original.conversationId) {
      await this.db
        .update(messages)
        .set({ jobId: id })
        .where(eq(messages.jobId, original.id));
    }

    return { jobId: id };
  }
}

/**
 * Builds a plain-English task string from structured review comments.
 * Used by the webhook path (approach A) where comments come from GitHub payload.
 * The UI path (approach B) accepts a user-typed task string directly.
 */
function buildTaskFromComments(comments: PrReviewComment[], reviewNote?: string | null): string {
  const lines: string[] = [];

  if (reviewNote?.trim()) {
    lines.push(`Review feedback: ${reviewNote.trim()}`);
    lines.push('');
  }

  if (comments.length > 0) {
    lines.push('Address the following review comments:');
    for (const c of comments) {
      const location = c.path ? `[${c.path}${c.line ? `:${c.line}` : ''}]` : '[general]';
      lines.push(`${location} ${c.body.trim()}`);
    }
  }

  return lines.join('\n') || 'Address review feedback.';
}
