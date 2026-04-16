import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const repoMemories = pgTable(
  'repo_memories',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    repoKey: text('repo_key').notNull().unique(),
    contentUri: text('content_uri').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    entryCount: integer('entry_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxRepoKey: uniqueIndex('idx_repo_memories_repo_key').on(t.repoKey),
    idxUpdatedAt: index('idx_repo_memories_updated_at').on(t.updatedAt),
  }),
);

export type RepoMemory = typeof repoMemories.$inferSelect;
export type NewRepoMemory = typeof repoMemories.$inferInsert;
