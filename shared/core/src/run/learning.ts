import { randomUUID } from 'node:crypto';
import { type Database, jobs } from '@shared/db';
import {
  EMPTY_MEMORY_TEMPLATE,
  InvalidMemoryFormatError,
  MemoryTooLargeError,
  loadMemoryFile,
  normalizeRepoKey,
  saveMemoryFile,
} from '@shared/memory';
import { StorageNotConfiguredError } from '@shared/storage';
import type { SandboxInfo } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import { LEARNING_AGENT } from '../defaults/learning-agent';
import { gatherJobContext } from './job-context';
import { appendTimeline } from './transitions';

/**
 * Runs a single-turn learning pass against the sandbox to update the repo's
 * MEMORY.md file with observations from the completed job.
 *
 * This is orchestrator-level (not a workflow step). Failures are logged at
 * warn and do NOT fail the job — the previous memory is kept intact.
 */
export async function runLearningPass(
  jobId: string,
  sandboxInfo: SandboxInfo,
  workspace: string,
  deps: { db: Database; log: Logger },
): Promise<void> {
  const { db, log } = deps;

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) {
    log.warn({ jobId }, 'learning pass: job not found, skipping');
    return;
  }

  let repoKey: string;
  try {
    repoKey = normalizeRepoKey(job.githubUrl);
  } catch (err) {
    log.warn({ jobId, githubUrl: job.githubUrl, err }, 'learning pass: cannot normalize repo key, skipping');
    return;
  }

  // Load current memory (or empty template for first job on this repo)
  const currentMemory = (await loadMemoryFile(db, repoKey)) ?? EMPTY_MEMORY_TEMPLATE(repoKey);
  const jobContext = await gatherJobContext(jobId, db);

  const userPrompt = `Current memory file:

${currentMemory}

---

Job context (job id: ${job.id.substring(0, 8)}):

${jobContext}

---

Please return the updated memory file in full. Use job id "${job.id.substring(0, 8)}" for any new entries you add.`;

  // Call the sandbox /prompt endpoint with maxTurns: 1
  let responseText: string;
  try {
    responseText = await callSandboxForText(sandboxInfo, {
      sessionId: `${jobId}:learning`,
      jobId,
      title: `Learning pass for job ${job.id.substring(0, 8)}`,
      description: userPrompt,
      workingDir: workspace,
      model: LEARNING_AGENT.model,
      systemPrompt: LEARNING_AGENT.systemPrompt,
      maxTurns: 1,
      env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' },
    });
  } catch (err) {
    log.warn({ err, jobId, repoKey }, 'learning pass: LLM call failed; keeping previous memory');
    return;
  }

  const newMarkdown = responseText.trim();
  if (!newMarkdown) {
    log.warn({ jobId, repoKey }, 'learning pass: empty response; keeping previous memory');
    return;
  }

  try {
    const { sizeBytes, entryCount } = await saveMemoryFile(db, repoKey, newMarkdown);
    const seq = await appendTimeline(db, jobId, 'memory-saved', { repoKey, sizeBytes, entryCount });
    log.info({ jobId, repoKey, sizeBytes, entryCount, seq }, 'memory file updated');
  } catch (err) {
    if (err instanceof InvalidMemoryFormatError || err instanceof MemoryTooLargeError) {
      log.warn(
        { jobId, repoKey, error: err.message },
        'learning pass: returned unusable memory; keeping previous',
      );
      // Save rejected output as a debug artifact in storage (best-effort)
      await saveRejectedArtifact(jobId, newMarkdown, log);
      const seq = await appendTimeline(db, jobId, 'memory-rejected', {
        repoKey,
        errors: err instanceof InvalidMemoryFormatError ? err.errors : [err.message],
      });
      log.warn({ jobId, seq }, 'memory-rejected event appended');
      return;
    }
    if (err instanceof StorageNotConfiguredError) {
      log.warn({ jobId, repoKey }, 'learning pass: storage not configured; skipping memory save');
      return;
    }
    // Any other storage error (e.g. NoSuchBucket) — warn and skip, never fail the job
    log.warn({ jobId, repoKey, err }, 'learning pass: storage error saving memory; keeping previous');
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

async function callSandboxForText(
  sandboxInfo: SandboxInfo,
  body: {
    sessionId: string;
    jobId: string;
    title: string;
    description: string;
    workingDir: string;
    model: string;
    systemPrompt: string;
    maxTurns: number;
    env: Record<string, string>;
  },
): Promise<string> {
  const requestId = randomUUID();
  const response = await fetch(`${sandboxInfo.endpoint}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error(`sandbox /prompt failed: ${response.status}`);
  }

  // The SDK emits a final { type: 'result', subtype: 'success', result: '<text>' } message.
  // Collect it from the SSE stream.
  let resultText = '';
  for await (const chunk of parseSSE(response.body)) {
    let parsed: unknown = chunk;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      /* leave as string */
    }

    if (parsed !== null && typeof parsed === 'object') {
      const msg = parsed as Record<string, unknown>;
      if (msg.type === 'error' && typeof msg.error === 'string') {
        throw new Error(`Agent error: ${msg.error}`);
      }
      if (msg.type === 'result') {
        if (msg.subtype === 'success' && typeof msg.result === 'string') {
          resultText = msg.result;
        } else if (typeof msg.subtype === 'string' && msg.subtype.startsWith('error')) {
          throw new Error(`Agent ended with error: ${msg.subtype}`);
        }
      }
    }
  }

  return resultText;
}

async function saveRejectedArtifact(
  jobId: string,
  content: string,
  log: Logger,
): Promise<void> {
  try {
    const { storage } = await import('@shared/storage');
    await storage.putObject(`artifacts/${jobId}/learning-rejected.md`, content, 'text/markdown');
  } catch {
    log.warn({ jobId }, 'learning pass: could not save rejected artifact');
  }
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
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
