import { sql } from 'drizzle-orm';
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const platformConfigs = pgTable('platform_configs', {
  platform:  text('platform').primaryKey(),
  enabled:   boolean('enabled').notNull().default(false),
  config:    jsonb('config').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export type PlatformConfig = typeof platformConfigs.$inferSelect;
