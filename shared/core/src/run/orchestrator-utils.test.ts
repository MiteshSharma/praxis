import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildPrBody, injectGithubToken, substituteInputs } from './orchestrator-utils';
import type { Job, Plan } from '@shared/db';

// ── substituteInputs ─────────────────────────────────────────────────────────

describe('substituteInputs', () => {
  it('replaces $input.<name> placeholders with resolved values', () => {
    const result = substituteInputs({ cmd: '$input.command' }, { command: 'echo hi' });
    expect(result).toEqual({ cmd: 'echo hi' });
  });

  it('leaves unresolved placeholders intact', () => {
    const result = substituteInputs({ x: '$input.missing' }, {});
    expect(result).toEqual({ x: '$input.missing' });
  });

  it('recurses into nested objects', () => {
    const result = substituteInputs(
      { outer: { inner: '$input.val' } },
      { val: 'resolved' },
    );
    expect((result.outer as Record<string, unknown>).inner).toBe('resolved');
  });

  it('passes through non-string values unchanged', () => {
    const result = substituteInputs({ n: 42, flag: true, arr: [1, 2] }, {});
    expect(result).toEqual({ n: 42, flag: true, arr: [1, 2] });
  });

  it('handles an empty object', () => {
    expect(substituteInputs({}, { x: 'y' })).toEqual({});
  });
});

// ── injectGithubToken ────────────────────────────────────────────────────────

describe('injectGithubToken', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_testtoken';
  });
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it('injects the token into an HTTPS URL', () => {
    const result = injectGithubToken('https://github.com/user/repo');
    expect(result).toBe('https://x-access-token:ghp_testtoken@github.com/user/repo');
  });

  it('returns the URL unchanged when no token is set', () => {
    delete process.env.GITHUB_TOKEN;
    expect(injectGithubToken('https://github.com/user/repo')).toBe(
      'https://github.com/user/repo',
    );
  });

  it('returns SSH URLs unchanged (token injection only applies to HTTPS)', () => {
    const ssh = 'git@github.com:user/repo.git';
    expect(injectGithubToken(ssh)).toBe(ssh);
  });
});

// ── buildPrBody ──────────────────────────────────────────────────────────────

const mockJob = {
  id: 'abc12345-0000-0000-0000-000000000000',
  title: 'Add feature X',
  description: 'Implement feature X as described in the task.',
} as unknown as Job;

const mockPlan = {
  data: {
    title: 'Plan for feature X',
    summary: 'Refactor the module and add the new endpoint.',
    steps: [
      { content: 'Step 1: refactor', status: 'done' },
      { content: 'Step 2: add endpoint', status: 'pending' },
    ],
    affectedPaths: ['src/routes/index.ts'],
    risks: ['Breaking change to existing consumers'],
    bodyMarkdown: '',
  },
} as unknown as Plan;

describe('buildPrBody', () => {
  it('includes the job description', () => {
    const body = buildPrBody(mockJob, null);
    expect(body).toContain('Implement feature X');
  });

  it('includes plan title and summary when plan is provided', () => {
    const body = buildPrBody(mockJob, mockPlan);
    expect(body).toContain('Plan for feature X');
    expect(body).toContain('Refactor the module');
  });

  it('marks completed steps with [x] and pending steps with [ ]', () => {
    const body = buildPrBody(mockJob, mockPlan);
    expect(body).toContain('- [x] Step 1: refactor');
    expect(body).toContain('- [ ] Step 2: add endpoint');
  });

  it('includes affected paths', () => {
    const body = buildPrBody(mockJob, mockPlan);
    expect(body).toContain('src/routes/index.ts');
  });

  it('includes risks', () => {
    const body = buildPrBody(mockJob, mockPlan);
    expect(body).toContain('Breaking change');
  });

  it('includes the job id in the footer', () => {
    const body = buildPrBody(mockJob, null);
    // first 8 chars of the UUID
    expect(body).toContain('abc12345');
  });

  it('works with a null plan', () => {
    const body = buildPrBody(mockJob, null);
    expect(body).not.toContain('## Plan');
    expect(body).toContain('## Task');
  });
});
