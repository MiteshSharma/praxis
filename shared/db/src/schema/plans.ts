import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    previousPlanId: uuid('previous_plan_id'),
    contentUri: text('content_uri').notNull(),
    data: jsonb('data').notNull().$type<PlanData>(),
    status: text('status').notNull().default('draft'),
    feedbackFromUser: text('feedback_from_user'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxJobVersion: uniqueIndex('idx_plans_job_id_version_unique').on(t.jobId, t.version),
    idxJobVersionDesc: index('idx_plans_job_id_version').on(t.jobId, t.version),
  }),
);

export interface PlanStep {
  id: string;
  content: string;
  status: 'pending' | 'done' | 'skipped';
}

export interface OpenQuestion {
  id: string;
  question: string;
  context?: string;
  options?: string[];
  answer: string | null;
}

export interface PlanData {
  title: string;
  summary: string;
  bodyMarkdown: string;
  steps: PlanStep[];
  affectedPaths: string[];
  risks?: string[];
  openQuestions?: OpenQuestion[];
}

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
