import { parseMarkdown } from './parser';
import type { Definition } from './types';

export interface LoadResult {
  definition: Definition;
  bodyMarkdown: string;
  commitSha?: string;
}

/**
 * Load a workflow or agent definition from a raw markdown string.
 */
export function loadFromInline(content: string): LoadResult {
  return parseMarkdown(content);
}

/**
 * Load a workflow or agent definition from a GitHub raw URL.
 *
 * URL format: `github.com/org/repo/path/to/file.md` (with optional `@sha` suffix)
 * or a full `https://raw.githubusercontent.com/...` URL.
 *
 * If no commit SHA is provided, resolves the default branch to a concrete SHA
 * via the GitHub API before fetching.
 */
export async function loadFromGithub(
  url: string,
  commitSha?: string,
  githubToken?: string,
): Promise<LoadResult> {
  const { rawUrl, resolvedSha } = await resolveGithubUrl(url, commitSha, githubToken);

  const headers: Record<string, string> = { 'user-agent': 'praxis/1.0' };
  if (githubToken) headers.authorization = `token ${githubToken}`;

  const res = await fetch(rawUrl, { headers });
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status} ${rawUrl}`);

  const content = await res.text();
  const { definition, bodyMarkdown } = parseMarkdown(content);
  return { definition, bodyMarkdown, commitSha: resolvedSha };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveGithubUrl(
  url: string,
  commitSha?: string,
  token?: string,
): Promise<{ rawUrl: string; resolvedSha: string }> {
  // Handle full https:// URLs (e.g. raw.githubusercontent.com)
  if (url.startsWith('https://')) {
    return { rawUrl: url, resolvedSha: commitSha ?? 'HEAD' };
  }

  // Parse: github.com/org/repo/path/to/file.md@sha
  const [repoPath, sha] = url.replace(/^github\.com\//, '').split('@');
  const parts = repoPath.split('/');
  if (parts.length < 3) throw new Error(`invalid GitHub URL: ${url}`);

  const [org, repo, ...fileParts] = parts;
  const filePath = fileParts.join('/');
  const resolvedSha = sha ?? commitSha ?? (await resolveDefaultBranchSha(org!, repo!, token));
  const rawUrl = `https://raw.githubusercontent.com/${org}/${repo}/${resolvedSha}/${filePath}`;

  return { rawUrl, resolvedSha };
}

async function resolveDefaultBranchSha(
  org: string,
  repo: string,
  token?: string,
): Promise<string> {
  const headers: Record<string, string> = { 'user-agent': 'praxis/1.0', accept: 'application/vnd.github+json' };
  if (token) headers.authorization = `token ${token}`;
  const res = await fetch(`https://api.github.com/repos/${org}/${repo}/commits/HEAD`, { headers });
  if (!res.ok) throw new Error(`GitHub API failed: ${res.status}`);
  const data = (await res.json()) as { sha: string };
  return data.sha;
}
