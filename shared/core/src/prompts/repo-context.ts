import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CANDIDATES = ['AGENTS.md', '.praxis/rules.md', '.cursorrules'];

/**
 * Reads the first repo-level agent configuration file found in the workspace.
 * Returns the file content (trimmed), or null if none of the candidates exist.
 *
 * Checked in order: AGENTS.md → .praxis/rules.md → .cursorrules
 */
export async function loadRepoContext(workingDir: string): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    try {
      const content = await readFile(join(workingDir, candidate), 'utf-8');
      if (content.trim()) return content.trim();
    } catch {
      /* file not found — try next */
    }
  }
  return null;
}
