import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    source: text('source').notNull(),
    contentUri: text('content_uri').notNull(),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxWorkflowId: index('idx_workflow_versions_workflow_id').on(t.workflowId),
    idxUnique: uniqueIndex('idx_workflow_versions_unique').on(t.workflowId, t.version),
  }),
);

export type Workflow = typeof workflows.$inferSelect;
export type WorkflowVersion = typeof workflowVersions.$inferSelect;
