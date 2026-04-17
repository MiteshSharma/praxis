import { type Database, memoryChunks, repoMemories } from '@shared/db';
import { InvalidMemoryFormatError, MemoryTooLargeError, type MemoryBackend } from '@shared/memory';
import { desc, eq } from 'drizzle-orm';

export class MemoriesService {
  constructor(
    private readonly db: Database,
    private readonly memoryBackend: MemoryBackend,
  ) {}

  async listRepos(): Promise<
    { repoKey: string; sizeBytes: number; entryCount: number; updatedAt: string }[]
  > {
    const rows = await this.db
      .select({
        repoKey: repoMemories.repoKey,
        sizeBytes: repoMemories.sizeBytes,
        entryCount: repoMemories.entryCount,
        updatedAt: repoMemories.updatedAt,
      })
      .from(repoMemories)
      .orderBy(desc(repoMemories.updatedAt));

    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  }

  async get(
    repoKey: string,
  ): Promise<{ repoKey: string; content: string; sizeBytes: number; entryCount: number; updatedAt: string } | null> {
    const row = await this.db.query.repoMemories.findFirst({
      where: eq(repoMemories.repoKey, repoKey),
    });
    if (!row) return null;

    // Empty query returns full content regardless of backend
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
    return this.memoryBackend.save(repoKey, content);
  }

  /** Re-throws InvalidMemoryFormatError and MemoryTooLargeError — callers convert to HTTP errors. */
  static isValidationError(err: unknown): err is InvalidMemoryFormatError | MemoryTooLargeError {
    return err instanceof InvalidMemoryFormatError || err instanceof MemoryTooLargeError;
  }

  async delete(repoKey: string): Promise<void> {
    // Best-effort S3 delete (no-op when storage is unconfigured or backend is builtin)
    try {
      const { storage } = await import('@shared/storage');
      const row = await this.db.query.repoMemories.findFirst({
        where: eq(repoMemories.repoKey, repoKey),
      });
      if (row) {
        await storage.deleteObject(row.contentUri);
      }
    } catch {
      /* storage may not be configured */
    }

    // Delete chunks (builtin backend stores content here; harmless for s3)
    await this.db.delete(memoryChunks).where(eq(memoryChunks.repoKey, repoKey));
    await this.db.delete(repoMemories).where(eq(repoMemories.repoKey, repoKey));
  }
}
