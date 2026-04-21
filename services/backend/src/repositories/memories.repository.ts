import type { Database } from '@shared/db';
import { memoryChunks, repoMemories } from '@shared/db';
import { desc, eq } from 'drizzle-orm';

export class MemoriesRepository {
  constructor(private readonly db: Database) {}

  async listRepos(): Promise<
    { repoKey: string; sizeBytes: number; entryCount: number; updatedAt: Date }[]
  > {
    return this.db
      .select({
        repoKey: repoMemories.repoKey,
        sizeBytes: repoMemories.sizeBytes,
        entryCount: repoMemories.entryCount,
        updatedAt: repoMemories.updatedAt,
      })
      .from(repoMemories)
      .orderBy(desc(repoMemories.updatedAt));
  }

  async findByRepoKey(repoKey: string): Promise<typeof repoMemories.$inferSelect | null> {
    const row = await this.db.query.repoMemories.findFirst({
      where: eq(repoMemories.repoKey, repoKey),
    });
    return row ?? null;
  }

  async deleteByRepoKey(repoKey: string): Promise<void> {
    await this.db.delete(repoMemories).where(eq(repoMemories.repoKey, repoKey));
  }

  async deleteChunksByRepoKey(repoKey: string): Promise<void> {
    await this.db.delete(memoryChunks).where(eq(memoryChunks.repoKey, repoKey));
  }
}
