import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobSteps } from './job-steps';
import { jobs } from './jobs';

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => jobSteps.id),
    kind: text('kind').notNull(),
    path: text('path'),
    url: text('url'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxJob: index('idx_artifacts_job_id').on(t.jobId),
    idxJobKind: index('idx_artifacts_job_id_kind').on(t.jobId, t.kind),
  }),
);

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
