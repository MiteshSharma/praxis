import { describe, it, expect } from 'vitest';
import { buildExecuteSystemPrompt } from './execute-session';

function makePlan(bodyMarkdown?: string): Parameters<typeof buildExecuteSystemPrompt>[0] {
  return {
    id: 'plan-1',
    jobId: 'job-1',
    version: 1,
    previousPlanId: null,
    contentUri: 'plans/job-1/v1',
    data: { title: 'Add feature', bodyMarkdown: bodyMarkdown ?? '## Steps\n1. Do thing' },
    status: 'approved',
    feedbackFromUser: null,
    approvedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('buildExecuteSystemPrompt', () => {
  it('includes APPROVED PLAN delimiters', () => {
    const prompt = buildExecuteSystemPrompt(makePlan());
    expect(prompt).toContain('--- APPROVED PLAN ---');
    expect(prompt).toContain('--- END PLAN ---');
  });

  it('embeds the plan bodyMarkdown', () => {
    const prompt = buildExecuteSystemPrompt(makePlan('## Steps\n1. Write the file\n2. Run tests'));
    expect(prompt).toContain('## Steps\n1. Write the file\n2. Run tests');
  });

  it('uses /workspace as default working dir', () => {
    const prompt = buildExecuteSystemPrompt(makePlan());
    expect(prompt).toContain('/workspace');
  });

  it('uses provided workingDir', () => {
    const prompt = buildExecuteSystemPrompt(makePlan(), '/home/agent/repo');
    expect(prompt).toContain('/home/agent/repo');
  });

  it('falls back gracefully when bodyMarkdown is missing', () => {
    const plan = makePlan();
    (plan.data as Record<string, unknown>).bodyMarkdown = undefined;
    const prompt = buildExecuteSystemPrompt(plan);
    expect(prompt).toContain('plan body unavailable');
  });

  it('instructs not to deviate from the plan', () => {
    const prompt = buildExecuteSystemPrompt(makePlan());
    expect(prompt.toLowerCase()).toContain('do not deviate');
  });

  it('instructs to summarize changes at the end', () => {
    const prompt = buildExecuteSystemPrompt(makePlan());
    expect(prompt.toLowerCase()).toContain('summarize');
  });

  it('instructs to read CLAUDE.md', () => {
    const prompt = buildExecuteSystemPrompt(makePlan());
    expect(prompt).toContain('CLAUDE.md');
  });
});
