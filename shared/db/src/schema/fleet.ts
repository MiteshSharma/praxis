import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations, messages } from './conversations';

export type FleetPlan = {
  currentWave: number;
  reasoning: string;
  phases: Array<{
    type: 'scout' | 'implement';
    sessions: string[]; // session IDs
    tasks: Record<string, string>; // sessionId → task text
  }>;
};

export const fleets = pgTable('fleets', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  mode: text('mode').notNull().default('fanout'),
  status: text('status').notNull().default('draft'),
  plan: jsonb('plan').$type<FleetPlan>(),
  autoApprove: boolean('auto_approve').notNull().default(false),
  maxParallel: integer('max_parallel').notNull().default(10),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fleetJobs = pgTable('fleet_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  fleetId: uuid('fleet_id')
    .notNull()
    .references(() => fleets.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => conversations.id),
  sessionMessageId: uuid('session_message_id').references(() => messages.id),
  jobType: text('job_type').notNull().default('implement'),
  task: text('task').notNull(),
  wave: integer('wave').notNull().default(1),
  status: text('status').notNull().default('pending'),
  report: jsonb('report').$type<Record<string, unknown>>(),
  retryCount: integer('retry_count').notNull().default(0),
  merged: boolean('merged').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fleetJobDeps = pgTable(
  'fleet_job_deps',
  {
    fleetJobId: uuid('fleet_job_id')
      .notNull()
      .references(() => fleetJobs.id, { onDelete: 'cascade' }),
    dependsOnId: uuid('depends_on_id')
      .notNull()
      .references(() => fleetJobs.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.fleetJobId, t.dependsOnId] }) }),
);

export type Fleet = typeof fleets.$inferSelect;
export type NewFleet = typeof fleets.$inferInsert;
export type FleetJob = typeof fleetJobs.$inferSelect;
export type NewFleetJob = typeof fleetJobs.$inferInsert;
