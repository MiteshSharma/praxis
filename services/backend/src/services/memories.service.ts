import { ORPCError } from '@orpc/server';
import { InvalidMemoryFormatError, MemoryTooLargeError, type MemoryBackend } from '@shared/memory';
import { MemoriesRepository } from '../repositories/memories.repository';

export class MemoriesService {
  constructor(
    private readonly repo: MemoriesRepository,
    private readonly memoryBackend: MemoryBackend,
  ) {}

  async listRepos(): Promise<
    { repoKey: string; sizeBytes: number; entryCount: number; updatedAt: string }[]
  > {
    const rows = await this.repo.listRepos();
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  }

  async get(
    repoKey: string,
  ): Promise<{ repoKey: string; content: string; sizeBytes: number; entryCount: number; updatedAt: string } | null> {
    const row = await this.repo.findByRepoKey(repoKey);
    if (!row) return null;

    const memory = await this.memoryBackend.loadForJob(repoKey, '');
    if (!memory) return null;

    return {
      repoKey: row.repoKey,
      content: memory.content,
      sizeBytes: row.sizeBytes,
      entryCount: row.entryCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(
    repoKey: string,
    content: string,
  ): Promise<{ sizeBytes: number; entryCount: number }> {
    try {
      return await this.memoryBackend.save(repoKey, content);
    } catch (err) {
      if (err instanceof InvalidMemoryFormatError || err instanceof MemoryTooLargeError) {
        throw new ORPCError('BAD_REQUEST', { message: (err as Error).message });
      }
      throw err;
    }
  }

  async delete(repoKey: string): Promise<void> {
    // Best-effort S3 delete (no-op when storage is unconfigured or backend is builtin)
    try {
      const { storage } = await import('@shared/storage');
      const row = await this.repo.findByRepoKey(repoKey);
      if (row) {
        await storage.deleteObject(row.contentUri);
      }
    } catch {
      /* storage may not be configured */
    }

    await this.repo.deleteChunksByRepoKey(repoKey);
    await this.repo.deleteByRepoKey(repoKey);
  }
}
