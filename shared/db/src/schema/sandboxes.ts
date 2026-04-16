import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';

export const sandboxes = pgTable(
  'sandboxes',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    status: text('status').notNull(),
    endpoint: text('endpoint'),
    heldUntil: timestamp('held_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
  },
  (t) => ({
    idxJob: index('idx_sandboxes_job_id').on(t.jobId),
  }),
);

export type Sandbox = typeof sandboxes.$inferSelect;
export type NewSandbox = typeof sandboxes.$inferInsert;
