import { type Database, jobSteps, jobs, plans } from '@shared/db';
import { asc, desc, eq } from 'drizzle-orm';

/**
 * Assembles a compact text summary of a completed job for use as context
 * in the learning pass. Includes the original request, the approved plan,
 * and the step history with truncated outputs.
 *
 * Note: the git diff is not included — the sandbox is destroyed before the
 * learning pass runs and the diff is not persisted in the DB.
 */
export async function gatherJobContext(jobId: string, db: Database): Promise<string> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return `(job ${jobId} not found)`;

  const plan = await db.query.plans.findFirst({
    where: eq(plans.jobId, jobId),
    orderBy: [desc(plans.version)],
  });

  const steps = await db.query.jobSteps.findMany({
    where: eq(jobSteps.jobId, jobId),
    orderBy: [asc(jobSteps.stepIndex)],
  });

  const sections: string[] = [];

  // Original request
  const request = [job.title, job.description].filter(Boolean).join('\n\n');
  sections.push(`## Original Request\n\n${request}`);

  // Approved plan body
  if (plan) {
    const data = plan.data as { bodyMarkdown?: string; title?: string };
    sections.push(`## Approved Plan\n\n${data.bodyMarkdown ?? '(no body)'}`);
  }

  // Step history with truncated output
  if (steps.length > 0) {
    const stepLines = steps.map((s) => {
      const output = s.output as Record<string, unknown> | null;
      const outputSnippet =
        output?.output ? `\n  Output: ${String(output.output).slice(0, 500)}` : '';
      return `- ${s.name} (${s.kind}) — ${s.status}${outputSnippet}`;
    });
    sections.push(`## Step History\n\n${stepLines.join('\n')}`);
  }

  return sections.join('\n\n---\n\n');
}
