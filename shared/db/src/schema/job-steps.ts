import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs';

export const jobSteps = pgTable(
  'job_steps',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    retryOf: uuid('retry_of').references((): AnyPgColumn => jobSteps.id),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').notNull(),
    status: text('status').notNull().default('pending'),
    dependsOn: jsonb('depends_on'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    output: jsonb('output'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    idxJobStep: index('idx_job_steps_job_id_step_index').on(t.jobId, t.stepIndex, t.id),
  }),
);

export type JobStep = typeof jobSteps.$inferSelect;
export type NewJobStep = typeof jobSteps.$inferInsert;
