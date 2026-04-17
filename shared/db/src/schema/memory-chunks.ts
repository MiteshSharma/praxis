import { sql } from 'drizzle-orm';
import { customType, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// Drizzle doesn't have built-in tsvector/vector types, so we declare them as custom.
const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});

const vector = customType<{ data: number[]; config: { dimensions: number } }>({
  dataType(config) { return `vector(${config?.dimensions ?? 1536})`; },
});

export const memoryChunks = pgTable(
  'memory_chunks',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    repoKey: text('repo_key').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    /** Generated column: to_tsvector('english', content). Read-only in Drizzle — never set directly. */
    ftsVector: tsvector('fts_vector'),
    /** OpenAI text-embedding-3-small (1536 dims). NULL until embeddings are generated. */
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqRepoChunk: unique('memory_chunks_repo_key_chunk_index_key').on(t.repoKey, t.chunkIndex),
    idxFts: index('idx_memory_chunks_fts').on(t.ftsVector),
    idxRepoKey: index('idx_memory_chunks_repo_key').on(t.repoKey),
    idxEmbedding: index('idx_memory_chunks_embedding').on(t.embedding),
  }),
);

export type MemoryChunk = typeof memoryChunks.$inferSelect;
export type NewMemoryChunk = typeof memoryChunks.$inferInsert;
