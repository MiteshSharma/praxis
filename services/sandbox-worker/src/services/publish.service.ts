import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Octokit } from '@octokit/rest';
import type { PublishInput, PublishResult } from '../dto/publish.dto';

export type { PublishInput, PublishResult };

/** Minimal surface of Octokit used by PublishService — injectable for testing. */
export interface OctokitLike {
  pulls: {
    create(params: {
      owner: string;
      repo: string;
      title: string;
      body: string;
      head: string;
      base: string;
    }): Promise<{ data: { number: number; html_url: string } }>;
  };
}

export type OctokitFactory = (token: string) => OctokitLike;

const execAsync = promisify(execCb);

async function runShell(command: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(command, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? '', GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.toString();
}

function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/);
  const owner = match?.[1];
  const repo = match?.[2];
  if (!owner || !repo) throw new Error(`cannot parse repo from ${repoUrl}`);
  return { owner, repo };
}

const defaultOctokitFactory: OctokitFactory = (token) =>
  new Octokit({ auth: token, request: { retries: 3 } });

export class PublishService {
  private readonly shell: (cmd: string, cwd: string) => Promise<string>;

  constructor(
    private readonly createOctokit: OctokitFactory = defaultOctokitFactory,
    shellFn?: (cmd: string, cwd: string) => Promise<string>,
  ) {
    this.shell = shellFn ?? runShell;
  }

  async publish(input: PublishInput): Promise<PublishResult | { error: string }> {
    const workspace = input.workingDir;
    const tokenUrl = input.repoUrl.replace(
      'https://',
      `https://x-access-token:${input.githubToken}@`,
    );

    await this.shell(`git config user.name "${input.gitAuthor.name}"`, workspace);
    await this.shell(`git config user.email "${input.gitAuthor.email}"`, workspace);
    await this.shell('git add -A', workspace);

    const status = await this.shell('git status --porcelain', workspace);
    if (!status.trim()) {
      return { error: 'no_changes' };
    }

    const escaped = input.commitMessage.replace(/"/g, '\\"');
    await this.shell(`git commit -m "${escaped}"`, workspace);
    await this.shell(`git push ${tokenUrl} ${input.branchName}`, workspace);
    const commitSha = (await this.shell('git rev-parse HEAD', workspace)).trim();

    const { owner, repo } = parseOwnerRepo(input.repoUrl);
    const octokit = this.createOctokit(input.githubToken);

    const { data } = await octokit.pulls.create({
      owner,
      repo,
      title: input.prTitle,
      body: input.prBody,
      head: input.branchName,
      base: input.baseBranch,
    });

    return {
      branchName: input.branchName,
      commitSha,
      prNumber: data.number,
      prUrl: data.html_url,
    };
  }
}
