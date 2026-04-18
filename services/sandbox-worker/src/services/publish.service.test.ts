import { describe, it, expect, beforeEach } from 'vitest';
import { PublishService } from './publish.service';
import { createMockOctokit, createMockShell } from '../__tests__/mocks';
import type { PublishInput } from '../dto/publish.dto';

const BASE_INPUT: PublishInput = {
  sessionId: 'sess-1',
  repoUrl: 'https://github.com/owner/repo',
  baseBranch: 'main',
  branchName: 'praxis/job-abc12345',
  commitMessage: 'chore: praxis changes',
  prTitle: 'Praxis: fix the thing',
  prBody: 'Auto-generated PR',
  githubToken: 'ghp_token',
  gitAuthor: { name: 'Praxis Bot', email: 'bot@praxis.dev' },
  workingDir: '/tmp/workspace',
};

describe('PublishService.publish', () => {
  let octokit: ReturnType<typeof createMockOctokit>;
  let shell: ReturnType<typeof createMockShell>;

  beforeEach(() => {
    octokit = createMockOctokit({ number: 7, html_url: 'https://github.com/owner/repo/pull/7' });
    shell = createMockShell({ 'git status --porcelain': 'M src/index.ts', 'git rev-parse HEAD': 'abc1234\n' });
  });

  it('returns no_changes when working tree is clean', async () => {
    const cleanShell = createMockShell({ 'git status --porcelain': '' });
    const svc = new PublishService(() => octokit, cleanShell as never);
    const result = await svc.publish(BASE_INPUT);
    expect(result).toEqual({ error: 'no_changes' });
  });

  it('runs git config, add, commit, push in order', async () => {
    const svc = new PublishService(() => octokit, shell as never);
    await svc.publish(BASE_INPUT);

    const calls = (shell as ReturnType<typeof vi.fn>).mock.calls.map((c: [string, string]) => c[0]);
    expect(calls[0]).toContain('git config user.name');
    expect(calls[1]).toContain('git config user.email');
    expect(calls[2]).toBe('git add -A');
    expect(calls[3]).toBe('git status --porcelain');
    expect(calls[4]).toContain('git commit -m');
    expect(calls[5]).toContain('git push');
    expect(calls[6]).toBe('git rev-parse HEAD');
  });

  it('embeds token in push URL', async () => {
    const svc = new PublishService(() => octokit, shell as never);
    await svc.publish(BASE_INPUT);

    const pushCall = (shell as ReturnType<typeof vi.fn>).mock.calls.find((c: [string, string]) =>
      c[0].startsWith('git push'),
    );
    expect(pushCall?.[0]).toContain('x-access-token:ghp_token@github.com');
  });

  it('creates PR with correct owner/repo parsed from URL', async () => {
    const svc = new PublishService(() => octokit, shell as never);
    await svc.publish(BASE_INPUT);

    expect(octokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo' }),
    );
  });

  it('returns prUrl, prNumber, branchName, commitSha on success', async () => {
    const svc = new PublishService(() => octokit, shell as never);
    const result = await svc.publish(BASE_INPUT);

    expect(result).toEqual({
      branchName: 'praxis/job-abc12345',
      commitSha: 'abc1234',
      prNumber: 7,
      prUrl: 'https://github.com/owner/repo/pull/7',
    });
  });

  it('escapes double-quotes in commit message', async () => {
    const svc = new PublishService(() => octokit, shell as never);
    await svc.publish({ ...BASE_INPUT, commitMessage: 'fix: add "quoted" word' });

    const commitCall = (shell as ReturnType<typeof vi.fn>).mock.calls.find((c: [string, string]) =>
      c[0].startsWith('git commit'),
    );
    expect(commitCall?.[0]).toContain('\\"quoted\\"');
  });

  it('uses workingDir as cwd for every shell call', async () => {
    const svc = new PublishService(() => octokit, shell as never);
    await svc.publish(BASE_INPUT);

    const allCwds = (shell as ReturnType<typeof vi.fn>).mock.calls.map((c: [string, string]) => c[1]);
    expect(allCwds.every((cwd: string) => cwd === '/tmp/workspace')).toBe(true);
  });

  it('throws when repo URL cannot be parsed', async () => {
    const svc = new PublishService(() => octokit, shell as never);
    await expect(
      svc.publish({ ...BASE_INPUT, repoUrl: 'https://example.com/bad' }),
    ).rejects.toThrow('cannot parse repo');
  });
});
