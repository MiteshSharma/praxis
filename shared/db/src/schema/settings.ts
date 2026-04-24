import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Global key-value settings store.
 * Seeded with defaults on first access — see settings.repository.ts.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Setting = typeof settings.$inferSelect;

/** All known setting keys — used to seed defaults and validate updates. */
export const SETTING_KEYS = {
  LEARNING_MODEL: 'learning_model',
  REPORT_MODEL: 'report_model',
  COMMUNICATION_MODEL: 'communication_model',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  learning_model: 'claude-haiku-4-5-20251001',
  report_model: 'claude-haiku-4-5-20251001',
  communication_model: 'claude-haiku-4-5-20251001',
};

export const SETTING_DESCRIPTIONS: Record<SettingKey, string> = {
  learning_model:
    'Model used for the learning pass (updates repo MEMORY.md after each job). Runs single-turn with no tools — a fast cheap model is ideal.',
  report_model:
    'Model used for the report pass (generates structured JSON summary after each job). Runs single-turn with no tools — a fast cheap model is ideal.',
  communication_model:
    'Model used for intent classification in messaging channels (Slack etc). Single-turn structured output — a fast cheap model is ideal.',
};
