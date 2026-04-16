import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workflows } from './workflows';

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  title: text('title').notNull(),
  defaultGithubUrl: text('default_github_url'),
  defaultWorkflowId: uuid('default_workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant' | 'system'
    content: text('content').notNull(),
    jobId: uuid('job_id'), // references jobs — no FK here to avoid circular schema dep
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxConvCreated: index('idx_messages_conversation_id').on(t.conversationId, t.createdAt),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
