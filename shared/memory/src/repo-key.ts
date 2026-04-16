/**
 * Normalizes a GitHub repo URL to a stable key used as the primary identifier
 * for repo memory files. Collapses HTTPS/SSH/`.git` variants to the same key.
 *
 * Examples:
 *   "https://github.com/User/Repo.git" → "github.com/user/repo"
 *   "https://github.com/user/repo"     → "github.com/user/repo"
 */
export function normalizeRepoKey(githubUrl: string): string {
  // Strip inline credentials (https://x-access-token:TOKEN@github.com/...)
  const clean = githubUrl.replace(/\/\/[^@]*@/, '//');
  const parsed = new URL(clean);
  const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  const [owner, repo] = parts;
  if (!owner || !repo) throw new Error(`Cannot normalize repo URL: ${githubUrl}`);
  return `${parsed.hostname.toLowerCase()}/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}
