import { randomUUID } from 'node:crypto';
import type { JobStatus, NotifyEvent } from '@shared/contracts';
import { type Database, type Job, artifacts, jobs, sandboxes } from '@shared/db';
import type { LocalSandboxProvider, SandboxInfo } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { emitNotification } from '../egress/notify';
import { appendTimeline, transitionJob } from './transitions';

export interface JobOrchestratorDeps {
  db: Database;
  boss: PgBoss;
  sandbox: LocalSandboxProvider;
  log: Logger;
}

export class JobOrchestrator {
  constructor(private readonly deps: JobOrchestratorDeps) {}

  async run(jobId: string): Promise<void> {
    const { db, boss, sandbox, log } = this.deps;
    const jobRow = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!jobRow) {
      log.warn({ jobId }, 'orchestrator: job not found');
      return;
    }

    const jobLog = log.child({ jobId });
    let sandboxInfo: SandboxInfo | undefined;

    try {
      // queued → provisioning
      if (!(await this.transition(jobId, 'queued', 'provisioning', { startedAt: new Date() }))) {
        jobLog.warn({ status: jobRow.status }, 'job not in queued state, skipping');
        return;
      }

      sandboxInfo = await sandbox.create({ jobId });
      await db.insert(sandboxes).values({
        jobId,
        providerId: sandboxInfo.providerId,
        status: 'running',
        endpoint: sandboxInfo.endpoint,
      });
      await appendTimeline(db, jobId, 'sandbox-ready', {
        providerId: sandboxInfo.providerId,
        endpoint: sandboxInfo.endpoint,
      });

      // provisioning → preparing
      await this.mustTransition(jobId, 'provisioning', 'preparing');

      // Clone repo into the sandbox's workspace
      const workspace = sandbox.workspaceFor(sandboxInfo.providerId);
      const cloneUrl = injectToken(jobRow.githubUrl);
      const clone = await sandbox.exec(
        sandboxInfo.providerId,
        `git clone --depth 1 --branch ${jobRow.githubBranch} ${cloneUrl} .`,
        { cwd: workspace, timeoutSeconds: 120 },
      );
      if (clone.exitCode !== 0) {
        throw new Error(`git clone failed: ${clone.stderr.slice(0, 500)}`);
      }
      const shaResult = await sandbox.exec(sandboxInfo.providerId, 'git rev-parse HEAD', {
        cwd: workspace,
      });
      const commitSha = shaResult.stdout.trim();
      await db.update(jobs).set({ githubCommitSha: commitSha }).where(eq(jobs.id, jobId));

      // preparing → executing
      await this.mustTransition(jobId, 'preparing', 'executing');

      await this.runAgentSession(jobRow, sandboxInfo, workspace);

      // executing → finalizing
      await this.mustTransition(jobId, 'executing', 'finalizing');

      const publishResult = await this.publish(jobRow, sandboxInfo, workspace);

      if (publishResult) {
        const [artifact] = await db
          .insert(artifacts)
          .values({
            jobId,
            kind: 'pr',
            path: null,
            url: publishResult.prUrl,
            metadata: {
              branchName: publishResult.branchName,
              commitSha: publishResult.commitSha,
              prNumber: publishResult.prNumber,
              repoUrl: jobRow.githubUrl,
            },
          })
          .returning();
        if (artifact) {
          const seq = await appendTimeline(db, jobId, 'artifact-created', {
            artifactId: artifact.id,
            kind: 'pr',
            url: artifact.url,
          });
          await this.emit(jobId, seq, {
            kind: 'artifact-created',
            artifactId: artifact.id,
            artifactKind: 'pr',
            url: artifact.url ?? undefined,
          });
        }
      }

      // finalizing → completed
      const completed = await this.transition(jobId, 'finalizing', 'completed', {
        completedAt: new Date(),
      });
      if (completed) {
        await this.emit(jobId, completed.seq + 1, {
          kind: 'completed',
          summary: publishResult?.prUrl,
        });
      }
      jobLog.info({ prUrl: publishResult?.prUrl }, 'job completed');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      jobLog.error({ err }, 'job failed');
      const current = (await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) }))?.status as
        | JobStatus
        | undefined;
      if (current && current !== 'failed' && current !== 'completed') {
        const failed = await transitionJob(db, jobId, current, 'failed', {
          errorMessage,
          errorCategory: 'permanent',
        });
        if (failed) {
          await this.emit(jobId, failed.seq + 1, {
            kind: 'failed',
            error: errorMessage,
            errorCategory: 'permanent',
          });
        }
      }
    } finally {
      if (sandboxInfo) {
        await sandbox.destroy(sandboxInfo.providerId).catch(() => undefined);
        await db
          .update(sandboxes)
          .set({ status: 'destroyed', destroyedAt: new Date() })
          .where(eq(sandboxes.providerId, sandboxInfo.providerId));
        await appendTimeline(db, jobId, 'sandbox-destroyed', {
          providerId: sandboxInfo.providerId,
        });
      }
    }
  }

  private async runAgentSession(
    job: Job,
    sandboxInfo: SandboxInfo,
    workspace: string,
  ): Promise<void> {
    const { db, log } = this.deps;
    const requestId = randomUUID();

    const response = await fetch(`${sandboxInfo.endpoint}/prompt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify({
        sessionId: job.id,
        jobId: job.id,
        title: job.title,
        description: job.description,
        workingDir: workspace,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
        },
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`sandbox /prompt failed: ${response.status}`);
    }

    for await (const chunk of parseSSE(response.body)) {
      let parsed: unknown = chunk;
      try {
        parsed = JSON.parse(chunk);
      } catch {
        // leave as string
      }
      const seq = await appendTimeline(db, job.id, 'chunk', { chunk: parsed });
      await this.emit(job.id, seq, {
        kind: 'chunk',
        raw: parsed,
      });
    }

    log.info({ jobId: job.id }, 'agent session finished');
  }

  private async publish(
    job: Job,
    sandboxInfo: SandboxInfo,
    _workspace: string,
  ): Promise<{
    branchName: string;
    commitSha: string;
    prNumber: number;
    prUrl: string;
  } | null> {
    const { log } = this.deps;

    const githubToken = process.env.GITHUB_TOKEN ?? '';
    if (!githubToken) {
      log.warn({ jobId: job.id }, 'GITHUB_TOKEN not set — skipping /publish; no PR will be opened');
      return null;
    }

    const requestId = randomUUID();
    const response = await fetch(`${sandboxInfo.endpoint}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify({
        sessionId: job.id,
        repoUrl: job.githubUrl,
        baseBranch: job.githubBranch,
        branchName: `praxis/job-${job.id.substring(0, 8)}`,
        commitMessage: job.title,
        prTitle: job.title,
        prBody: `${job.description ?? ''}\n\nCreated by Praxis (job ${job.id}).`,
        githubToken,
        gitAuthor: { name: 'praxis[bot]', email: 'bot@praxis.local' },
        workingDir: sandboxInfo.providerId.replace(/^local:\/\//, ''),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`publish failed: ${response.status} ${detail}`);
    }

    return (await response.json()) as {
      branchName: string;
      commitSha: string;
      prNumber: number;
      prUrl: string;
    };
  }

  private async transition(
    jobId: string,
    from: JobStatus,
    to: JobStatus,
    patch: Parameters<typeof transitionJob>[4] = {},
  ): Promise<{ seq: number } | null> {
    const result = await transitionJob(this.deps.db, jobId, from, to, patch);
    if (!result) return null;
    await this.emit(jobId, result.seq, { kind: 'status-changed', from, to });
    return { seq: result.seq };
  }

  private async mustTransition(jobId: string, from: JobStatus, to: JobStatus): Promise<void> {
    const r = await this.transition(jobId, from, to);
    if (!r) throw new Error(`transition ${from} → ${to} rejected`);
  }

  private async emit(jobId: string, seq: number, event: NotifyEvent): Promise<void> {
    try {
      await emitNotification(this.deps.boss, jobId, seq, event);
    } catch (err) {
      this.deps.log.error({ err, jobId, event: event.kind }, 'notification enqueue failed');
    }
  }
}

function injectToken(url: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !url.startsWith('https://')) return url;
  return url.replace('https://', `https://x-access-token:${token}@`);
}

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic stream frame split
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6));
        if (dataLines.length === 0) continue;
        yield dataLines.join('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
