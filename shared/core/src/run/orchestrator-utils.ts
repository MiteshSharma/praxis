import type { Job, Plan } from '@shared/db';

/**
 * Builds a markdown PR body from the job description and approved plan.
 */
export function buildPrBody(job: Job, plan: Plan | null): string {
  const parts: string[] = [];

  if (job.description) {
    parts.push(`## Task\n\n${job.description}`);
  }

  if (plan) {
    parts.push(`## Plan\n\n**${plan.data.title}**\n\n${plan.data.summary}`);

    if (plan.data.steps.length > 0) {
      const steps = plan.data.steps
        .map((s) => `- [${s.status === 'done' ? 'x' : ' '}] ${s.content}`)
        .join('\n');
      parts.push(`### Steps\n\n${steps}`);
    }

    if (plan.data.affectedPaths.length > 0) {
      parts.push(`### Affected files\n\n${plan.data.affectedPaths.map((p) => `- \`${p}\``).join('\n')}`);
    }

    if (plan.data.risks && plan.data.risks.length > 0) {
      parts.push(`### Risks\n\n${plan.data.risks.map((r) => `- ${r}`).join('\n')}`);
    }

    if (plan.data.bodyMarkdown) {
      parts.push(`### Full plan\n\n${plan.data.bodyMarkdown}`);
    }
  }

  parts.push(`---\n_Created by [Praxis](https://github.com/MiteshSharma/praxis) · job \`${job.id.substring(0, 8)}\`_`);

  return parts.join('\n\n');
}

/**
 * Injects a GitHub token into an HTTPS clone URL so the sandbox can authenticate.
 */
export function injectGithubToken(url: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !url.startsWith('https://')) return url;
  return url.replace('https://', `https://x-access-token:${token}@`);
}

/**
 * Walk an object and replace `"$input.<name>"` strings with the resolved input value.
 */
export function substituteInputs(
  obj: Record<string, unknown>,
  inputs: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      result[k] = v.replace(/\$input\.(\w+)/g, (_, name: string) => inputs[name] ?? `$input.${name}`);
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = substituteInputs(v as Record<string, unknown>, inputs);
    } else {
      result[k] = v;
    }
  }
  return result;
}
