import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversations';

export const plugins = pgTable(
  'plugins',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    transport: text('transport').notNull(), // 'stdio' | 'http'
    command: text('command'),
    url: text('url'),
    env: jsonb('env').notNull().default(sql`'{}'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxConvId: index('idx_plugins_conversation_id').on(t.conversationId),
    idxUnique: uniqueIndex('idx_plugins_unique').on(t.conversationId, t.name),
  }),
);

export type Plugin = typeof plugins.$inferSelect;
export type NewPlugin = typeof plugins.$inferInsert;
