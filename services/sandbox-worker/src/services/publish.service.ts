import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Octokit } from '@octokit/rest';
import type { PublishInput, PublishResult } from '../dto/publish.dto';

export type { PublishInput, PublishResult };

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

export class PublishService {
  async publish(input: PublishInput): Promise<PublishResult | { error: string }> {
    const workspace = input.workingDir;
    const tokenUrl = input.repoUrl.replace(
      'https://',
      `https://x-access-token:${input.githubToken}@`,
    );

    await runShell(`git config user.name "${input.gitAuthor.name}"`, workspace);
    await runShell(`git config user.email "${input.gitAuthor.email}"`, workspace);
    await runShell('git add -A', workspace);

    const status = await runShell('git status --porcelain', workspace);
    if (!status.trim()) {
      return { error: 'no_changes' };
    }

    const escaped = input.commitMessage.replace(/"/g, '\\"');
    await runShell(`git commit -m "${escaped}"`, workspace);
    await runShell(`git push ${tokenUrl} ${input.branchName}`, workspace);
    const commitSha = (await runShell('git rev-parse HEAD', workspace)).trim();

    const { owner, repo } = parseOwnerRepo(input.repoUrl);
    const octokit = new Octokit({ auth: input.githubToken, request: { retries: 3 } });

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
