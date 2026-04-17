import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversations';

export const conversationChannels = pgTable(
  'conversation_channels',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'webhook'
    name: text('name').notNull(),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxConvId: index('idx_conversation_channels_conv').on(t.conversationId),
  }),
);

export type ConversationChannel = typeof conversationChannels.$inferSelect;
export type NewConversationChannel = typeof conversationChannels.$inferInsert;
