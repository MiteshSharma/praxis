import { describe, it, expect } from 'vitest';
import { buildRevisionSystemPrompt } from './revision-session';

function makePlan(overrides: {
  version?: number;
  bodyMarkdown?: string;
  openQuestions?: Array<{ id: string; question: string }>;
} = {}): Parameters<typeof buildRevisionSystemPrompt>[0]['previousPlan'] {
  return {
    id: 'plan-1',
    jobId: 'job-1',
    version: overrides.version ?? 2,
    previousPlanId: null,
    contentUri: 'plans/job-1/v2',
    data: {
      title: 'Refactor auth',
      bodyMarkdown: overrides.bodyMarkdown ?? '## Steps\n1. Move auth to its own file',
      openQuestions: overrides.openQuestions ?? [],
    },
    status: 'rejected',
    feedbackFromUser: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('buildRevisionSystemPrompt', () => {
  it('includes PREVIOUS PLAN delimiters with version number', () => {
    const prompt = buildRevisionSystemPrompt({ previousPlan: makePlan({ version: 3 }) });
    expect(prompt).toContain('--- PREVIOUS PLAN (v3) ---');
    expect(prompt).toContain('--- END PREVIOUS PLAN ---');
  });

  it('embeds previous plan bodyMarkdown', () => {
    const prompt = buildRevisionSystemPrompt({
      previousPlan: makePlan({ bodyMarkdown: '## Steps\n1. Custom step' }),
    });
    expect(prompt).toContain('## Steps\n1. Custom step');
  });

  it('uses /workspace as default working dir', () => {
    const prompt = buildRevisionSystemPrompt({ previousPlan: makePlan() });
    expect(prompt).toContain('/workspace');
  });

  it('uses provided workingDir', () => {
    const prompt = buildRevisionSystemPrompt({ previousPlan: makePlan() }, '/custom/path');
    expect(prompt).toContain('/custom/path');
  });

  it('shows "(no answers provided)" when no answers given', () => {
    const prompt = buildRevisionSystemPrompt({ previousPlan: makePlan() });
    expect(prompt).toContain('no answers provided');
  });

  it('formats answers with question text when openQuestions are available', () => {
    const openQuestions = [
      { id: 'q1', question: 'Which pattern to use?' },
      { id: 'q2', question: 'Separate file or inline?' },
    ];
    const prompt = buildRevisionSystemPrompt({
      previousPlan: makePlan({ openQuestions }),
      answers: { q1: 'Use factory pattern', q2: 'Separate file' },
    });
    expect(prompt).toContain('Q: Which pattern to use?');
    expect(prompt).toContain('A: Use factory pattern');
    expect(prompt).toContain('Q: Separate file or inline?');
    expect(prompt).toContain('A: Separate file');
  });

  it('falls back to answer id as label when question not found in openQuestions', () => {
    const prompt = buildRevisionSystemPrompt({
      previousPlan: makePlan({ openQuestions: [] }),
      answers: { orphan_id: 'Some answer' },
    });
    expect(prompt).toContain('Q: orphan_id');
    expect(prompt).toContain('A: Some answer');
  });

  it('includes additionalFeedback when provided', () => {
    const prompt = buildRevisionSystemPrompt({
      previousPlan: makePlan(),
      additionalFeedback: 'Please keep it simpler',
    });
    expect(prompt).toContain('Please keep it simpler');
    expect(prompt).toContain('Additional feedback from user');
  });

  it('omits additionalFeedback section when not provided', () => {
    const prompt = buildRevisionSystemPrompt({ previousPlan: makePlan() });
    expect(prompt).not.toContain('Additional feedback from user');
  });

  it('instructs to include a "What changed" section', () => {
    const prompt = buildRevisionSystemPrompt({ previousPlan: makePlan() });
    expect(prompt).toContain('What changed');
  });

  it('falls back gracefully when bodyMarkdown is missing', () => {
    const plan = makePlan();
    (plan.data as Record<string, unknown>).bodyMarkdown = undefined;
    const prompt = buildRevisionSystemPrompt({ previousPlan: plan });
    expect(prompt).toContain('plan body unavailable');
  });

  it('multiple answers are separated with blank lines', () => {
    const openQuestions = [
      { id: 'q1', question: 'Q one?' },
      { id: 'q2', question: 'Q two?' },
    ];
    const prompt = buildRevisionSystemPrompt({
      previousPlan: makePlan({ openQuestions }),
      answers: { q1: 'Answer one', q2: 'Answer two' },
    });
    // The two Q&A blocks should be separated
    const q1Idx = prompt.indexOf('Q: Q one?');
    const q2Idx = prompt.indexOf('Q: Q two?');
    expect(q1Idx).toBeGreaterThanOrEqual(0);
    expect(q2Idx).toBeGreaterThan(q1Idx);
  });
});
