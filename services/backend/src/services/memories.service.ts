import { type Database, repoMemories } from '@shared/db';
import {
  InvalidMemoryFormatError,
  MemoryTooLargeError,
  loadMemoryFile,
  saveMemoryFile,
} from '@shared/memory';
import { desc, eq } from 'drizzle-orm';

export class MemoriesService {
  constructor(private readonly db: Database) {}

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

    const content = await loadMemoryFile(this.db, repoKey);
    if (content === null) return null;

    return {
      repoKey: row.repoKey,
      content,
      sizeBytes: row.sizeBytes,
      entryCount: row.entryCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(
    repoKey: string,
    content: string,
  ): Promise<{ sizeBytes: number; entryCount: number }> {
    return saveMemoryFile(this.db, repoKey, content);
  }

  /** Re-throws InvalidMemoryFormatError and MemoryTooLargeError — callers convert to HTTP errors. */
  static isValidationError(err: unknown): err is InvalidMemoryFormatError | MemoryTooLargeError {
    return err instanceof InvalidMemoryFormatError || err instanceof MemoryTooLargeError;
  }

  async delete(repoKey: string): Promise<void> {
    // Delete the storage object (best-effort; do not fail if storage is unconfigured)
    try {
      const { storage } = await import('@shared/storage');
      const row = await this.db.query.repoMemories.findFirst({
        where: eq(repoMemories.repoKey, repoKey),
      });
      if (row) {
        await storage.deleteObject(row.contentUri);
      }
    } catch {
      /* storage may not be configured — DB row still gets deleted */
    }

    await this.db.delete(repoMemories).where(eq(repoMemories.repoKey, repoKey));
  }
}
