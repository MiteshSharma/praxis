import { type Database, memoryChunks, repoMemories } from '@shared/db';
import {
  InvalidMemoryFormatError,
  type MemoryBackend,
  type MemoryContext,
  validateMemoryFormat,
} from '@shared/memory';
import { eq, sql } from 'drizzle-orm';
import { registerMemoryBackend } from './registry.js';

// ~1600 chars ≈ 400 tokens (rough approximation without a tokenizer)
const CHARS_PER_CHUNK = 1600;

class BuiltinMemoryBackend implements MemoryBackend {
  constructor(
    private readonly db: Database,
    private readonly maxChunks = 8,
  ) {}

  async loadForJob(repoKey: string, query: string): Promise<MemoryContext | null> {
    // 1. FTS search when a query is provided
    if (query.trim()) {
      const rows = await this.db.execute<{ chunk_index: number; content: string }>(
        sql`
          SELECT chunk_index, content
          FROM memory_chunks
          WHERE repo_key = ${repoKey}
            AND fts_vector @@ plainto_tsquery('english', ${query})
          ORDER BY ts_rank(fts_vector, plainto_tsquery('english', ${query})) DESC
          LIMIT ${this.maxChunks}
        `,
      );

      if (rows.length > 0) {
        // Reassemble in original order
        const sorted = [...rows].sort((a, b) => a.chunk_index - b.chunk_index);
        const content = sorted.map((r) => r.content).join('\n\n');
        return { content, source: 'fts', truncated: true };
      }
    }

    // 2. Fall back to full content stored in repo_memories
    const row = await this.db.query.repoMemories.findFirst({
      where: eq(repoMemories.repoKey, repoKey),
    });

    if (row?.content) {
      return { content: row.content, source: 'full', truncated: false };
    }

    return null;
  }

  async save(repoKey: string, markdown: string): Promise<{ sizeBytes: number; entryCount: number }> {
    const validation = validateMemoryFormat(markdown);
    if (!validation.ok) throw new InvalidMemoryFormatError(validation.errors);
    const { entryCount } = validation;
    const sizeBytes = Buffer.byteLength(markdown, 'utf-8');

    const chunks = chunkMarkdown(markdown);

    await this.db.transaction(async (tx) => {
      // Replace all existing chunks for this repo
      await tx.delete(memoryChunks).where(eq(memoryChunks.repoKey, repoKey));

      if (chunks.length > 0) {
        await tx.insert(memoryChunks).values(
          chunks.map((content, idx) => ({
            repoKey,
            chunkIndex: idx,
            content,
          })),
        );
      }

      // Upsert the repo_memories row with full content
      await tx
        .insert(repoMemories)
        .values({
          repoKey,
          content: markdown,
          contentUri: `builtin://${repoKey}`,
          sizeBytes,
          entryCount,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: repoMemories.repoKey,
          set: {
            content: markdown,
            sizeBytes,
            entryCount,
            updatedAt: new Date(),
          },
        });
    });

    return { sizeBytes, entryCount };
  }
}

/**
 * Splits a MEMORY.md into chunks of ~CHARS_PER_CHUNK.
 *
 * Strategy:
 *   1. Split on `## ` section headers — each section starts a new chunk group.
 *   2. Within a section, if the text exceeds CHARS_PER_CHUNK, split further at
 *      `- ` entry line boundaries so no entry is cut in half.
 *   3. Minimum chunk = one entry.
 */
function chunkMarkdown(markdown: string): string[] {
  const sections = markdown.split(/(?=^## )/m).filter(Boolean);
  const chunks: string[] = [];

  for (const section of sections) {
    if (section.length <= CHARS_PER_CHUNK) {
      chunks.push(section.trimEnd());
      continue;
    }

    // Split large sections at entry (bullet) boundaries
    const lines = section.split('\n');
    let current = '';

    for (const line of lines) {
      // A new entry line that would push us over the limit — flush current chunk first
      if (line.startsWith('- ') && current.length + line.length > CHARS_PER_CHUNK && current.trim()) {
        chunks.push(current.trimEnd());
        // Keep the section header for context in subsequent chunks
        const headerMatch = section.match(/^##[^\n]*/);
        current = headerMatch ? `${headerMatch[0]}\n\n` : '';
      }
      current += `${line}\n`;
    }

    if (current.trim()) {
      chunks.push(current.trimEnd());
    }
  }

  return chunks;
}

registerMemoryBackend('builtin', (config) => {
  const cfg = config as { db: Database; maxChunks?: number };
  if (!cfg.db) return null;
  return new BuiltinMemoryBackend(cfg.db, cfg.maxChunks);
});
