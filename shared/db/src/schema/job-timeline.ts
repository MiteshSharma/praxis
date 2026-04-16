import { sql } from 'drizzle-orm';
import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs';

export const jobTimeline = pgTable(
  'job_timeline',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jobSeqUnique: uniqueIndex('job_timeline_job_id_seq_key').on(t.jobId, t.seq),
  }),
);

export type JobTimelineEntry = typeof jobTimeline.$inferSelect;
export type NewJobTimelineEntry = typeof jobTimeline.$inferInsert;
