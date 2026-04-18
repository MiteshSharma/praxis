import { describe, it, expect, vi } from 'vitest';
import { gatherJobContext } from './job-context';

// ── DB mock helpers ───────────────────────────────────────────────────────────

function makeJob(overrides: Partial<{ title: string; description: string }> = {}) {
  return {
    id: 'job-1',
    title: overrides.title ?? 'Add login feature',
    description: overrides.description ?? 'Implement OAuth2 with GitHub',
  };
}

function makePlan(bodyMarkdown?: string) {
  return {
    id: 'plan-1',
    jobId: 'job-1',
    version: 1,
    data: { bodyMarkdown: bodyMarkdown ?? '## Steps\n1. Set up OAuth routes' },
  };
}

function makeStep(overrides: Partial<{
  name: string;
  kind: string;
  status: string;
  output: Record<string, unknown> | null;
  stepIndex: number;
}> = {}) {
  return {
    name: overrides.name ?? 'execute',
    kind: overrides.kind ?? 'execute',
    status: overrides.status ?? 'passed',
    output: overrides.output ?? null,
    stepIndex: overrides.stepIndex ?? 0,
  };
}

function makeDb(options: {
  job?: ReturnType<typeof makeJob> | null;
  plan?: ReturnType<typeof makePlan> | null;
  steps?: ReturnType<typeof makeStep>[];
} = {}) {
  return {
    query: {
      jobs: {
        findFirst: vi.fn().mockResolvedValue(options.job !== undefined ? options.job : makeJob()),
      },
      plans: {
        findFirst: vi.fn().mockResolvedValue(options.plan !== undefined ? options.plan : makePlan()),
      },
      jobSteps: {
        findMany: vi.fn().mockResolvedValue(options.steps ?? []),
      },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('gatherJobContext', () => {
  it('returns fallback message when job not found', async () => {
    const db = makeDb({ job: null });
    const ctx = await gatherJobContext('job-missing', db as never);
    expect(ctx).toContain('job-missing');
    expect(ctx).toContain('not found');
  });

  it('includes original request section with title', async () => {
    const db = makeDb({ job: makeJob({ title: 'Fix the login bug' }) });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).toContain('## Original Request');
    expect(ctx).toContain('Fix the login bug');
  });

  it('includes description when present', async () => {
    const db = makeDb({
      job: makeJob({ title: 'Fix bug', description: 'Users cannot log in on mobile' }),
    });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).toContain('Users cannot log in on mobile');
  });

  it('includes approved plan body', async () => {
    const db = makeDb({
      plan: makePlan('## Steps\n1. Check session tokens\n2. Fix the handler'),
    });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).toContain('## Approved Plan');
    expect(ctx).toContain('## Steps\n1. Check session tokens');
  });

  it('omits plan section when no plan exists', async () => {
    const db = makeDb({ plan: null });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).not.toContain('Approved Plan');
  });

  it('includes step history section when steps exist', async () => {
    const db = makeDb({
      steps: [
        makeStep({ name: 'plan', kind: 'plan', status: 'passed' }),
        makeStep({ name: 'execute', kind: 'execute', status: 'passed', stepIndex: 1 }),
      ],
    });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).toContain('## Step History');
    expect(ctx).toContain('plan (plan)');
    expect(ctx).toContain('execute (execute)');
  });

  it('omits step history when no steps', async () => {
    const db = makeDb({ steps: [] });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).not.toContain('Step History');
  });

  it('truncates step output to 500 characters', async () => {
    const longOutput = 'x'.repeat(1000);
    const db = makeDb({
      steps: [makeStep({ output: { output: longOutput } })],
    });
    const ctx = await gatherJobContext('job-1', db as never);
    // Output should be truncated in the context
    const outputSection = ctx.split('Output:')[1] ?? '';
    expect(outputSection.trimStart().length).toBeLessThanOrEqual(510); // 500 + small margin for newlines
  });

  it('omits output snippet when step has no output', async () => {
    const db = makeDb({
      steps: [makeStep({ output: null })],
    });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).not.toContain('Output:');
  });

  it('sections are separated by horizontal rules', async () => {
    const db = makeDb({
      steps: [makeStep()],
    });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).toContain('---');
  });

  it('shows (no body) when plan data has no bodyMarkdown', async () => {
    const db = makeDb({
      plan: { id: 'plan-1', jobId: 'job-1', version: 1, data: {} },
    });
    const ctx = await gatherJobContext('job-1', db as never);
    expect(ctx).toContain('(no body)');
  });
});
