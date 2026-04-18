import { describe, it, expect } from 'vitest';
import {
  buildPlanSessionSystemPrompt,
  buildMemorySection,
  PLAN_SESSION_SYSTEM_PROMPT,
} from './plan-session';

describe('buildPlanSessionSystemPrompt', () => {
  it('contains submit_plan instruction', () => {
    const prompt = buildPlanSessionSystemPrompt();
    expect(prompt).toContain('submit_plan');
  });

  it('uses /workspace as default working dir', () => {
    const prompt = buildPlanSessionSystemPrompt();
    expect(prompt).toContain('/workspace');
  });

  it('uses provided workingDir', () => {
    const prompt = buildPlanSessionSystemPrompt(undefined, '/home/user/repo');
    expect(prompt).toContain('/home/user/repo');
  });

  it('includes all required plan fields in instructions', () => {
    const prompt = buildPlanSessionSystemPrompt();
    for (const field of ['title', 'summary', 'bodyMarkdown', 'steps', 'affectedPaths', 'risks', 'openQuestions']) {
      expect(prompt).toContain(field);
    }
  });

  it('without parentContext does not include parent plan section', () => {
    const prompt = buildPlanSessionSystemPrompt();
    expect(prompt).not.toContain('PARENT PLAN');
    expect(prompt).not.toContain('Context from previous work');
  });

  it('with parentContext includes parent plan body and job title', () => {
    const prompt = buildPlanSessionSystemPrompt(
      { planBodyMarkdown: '## steps\n- do thing', jobTitle: 'Add auth' },
      '/workspace',
    );
    expect(prompt).toContain('PARENT PLAN');
    expect(prompt).toContain('## steps\n- do thing');
    expect(prompt).toContain('Add auth');
    expect(prompt).toContain('Context from previous work');
  });

  it('parent section instructs to build incrementally', () => {
    const prompt = buildPlanSessionSystemPrompt(
      { planBodyMarkdown: 'body', jobTitle: 'Job A' },
      '/workspace',
    );
    expect(prompt).toContain('incremental');
  });

  it('instructs not to write files or run commands during planning', () => {
    const prompt = buildPlanSessionSystemPrompt();
    expect(prompt.toLowerCase()).toContain('must not write');
  });
});

describe('buildMemorySection', () => {
  it('wraps content under a Repository memory heading', () => {
    const section = buildMemorySection('## Conventions\n- use tabs');
    expect(section).toContain('Repository memory');
    expect(section).toContain('## Conventions\n- use tabs');
  });

  it('includes caveat about verifying against code', () => {
    const section = buildMemorySection('content');
    expect(section.toLowerCase()).toContain('verify');
  });
});

describe('PLAN_SESSION_SYSTEM_PROMPT', () => {
  it('is the default prompt with no context', () => {
    expect(PLAN_SESSION_SYSTEM_PROMPT).toBe(buildPlanSessionSystemPrompt());
  });
});
