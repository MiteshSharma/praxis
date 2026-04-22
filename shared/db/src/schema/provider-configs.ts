import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const providerConfigs = pgTable('provider_configs', {
  provider: text('provider').primaryKey(), // 'anthropic' | 'openai' | 'openrouter'
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`), // non-secret extras (e.g. site_url)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export type ProviderConfig = typeof providerConfigs.$inferSelect;
