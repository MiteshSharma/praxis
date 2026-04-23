import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const platformSessions = pgTable('platform_sessions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  platform:       text('platform').notNull(),
  chatId:         text('chat_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  userId:         text('user_id'),
  userName:       text('user_name'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const platformThreads = pgTable('platform_threads', {
  id:        uuid('id').primaryKey().defaultRandom(),
  platform:  text('platform').notNull(),
  chatId:    text('chat_id').notNull(),
  threadId:  text('thread_id').notNull(),
  jobId:     uuid('job_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformSession = typeof platformSessions.$inferSelect;
export type PlatformThread  = typeof platformThreads.$inferSelect;
