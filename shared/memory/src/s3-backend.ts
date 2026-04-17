import type { Database } from '@shared/db';
import { loadMemoryFile, saveMemoryFile } from './memory-file.js';
import type { MemoryBackend, MemoryContext } from './types.js';

/**
 * Default memory backend. Stores MEMORY.md as an object in MinIO/S3.
 * Ignores the query parameter — always returns the full file.
 * Returns null gracefully when storage is not configured.
 */
export class S3MemoryBackend implements MemoryBackend {
  constructor(private readonly db: Database) {}

  async loadForJob(repoKey: string, _query: string): Promise<MemoryContext | null> {
    const markdown = await loadMemoryFile(this.db, repoKey);
    if (!markdown) return null;
    return { content: markdown, source: 'full', truncated: false };
  }

  async save(repoKey: string, markdown: string): Promise<{ sizeBytes: number; entryCount: number }> {
    return saveMemoryFile(this.db, repoKey, markdown);
  }
}
