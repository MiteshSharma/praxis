import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    conversationId: uuid('conversation_id'),

    source: text('source').notNull(),
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    title: text('title').notNull(),
    description: text('description'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    triggerKind: text('trigger_kind').notNull().default('user_prompt'),

    parentJobId: uuid('parent_job_id'),
    workflowId: uuid('workflow_id'),
    workflowVersionId: uuid('workflow_version_id'),
    disableLearning: boolean('disable_learning').notNull().default(false),

    githubUrl: text('github_url').notNull(),
    githubBranch: text('github_branch').notNull().default('main'),
    githubCommitSha: text('github_commit_sha'),

    status: text('status').notNull(),
    currentStepIndex: integer('current_step_index'),
    autoApprove: boolean('auto_approve').notNull().default(false),
    planReviewHoldUntil: timestamp('plan_review_hold_until', { withTimezone: true }),
    planRevisionCount: integer('plan_revision_count').notNull().default(0),
    maxPlanRevisions: integer('max_plan_revisions').notNull().default(5),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(2),
    errorMessage: text('error_message'),
    errorCategory: text('error_category'),

    totalInputTokens: integer('total_input_tokens'),
    totalOutputTokens: integer('total_output_tokens'),
    totalCostUsd: real('total_cost_usd'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    idxStatus: index('idx_jobs_status').on(t.status),
    idxConversation: index('idx_jobs_conversation_id_created_at').on(t.conversationId, t.createdAt),
    idxParent: index('idx_jobs_parent_job_id').on(t.parentJobId),
    idxSourceExternal: uniqueIndex('idx_jobs_source_external_id')
      .on(t.source, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
