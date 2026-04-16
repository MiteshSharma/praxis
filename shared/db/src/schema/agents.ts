import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    kind: text('kind').notNull().default('agent'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kindCheck: check('agents_kind_check', sql`${t.kind} IN ('agent', 'skill')`),
  }),
);

export const agentVersions = pgTable(
  'agent_versions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    source: text('source').notNull(),
    contentUri: text('content_uri').notNull(),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxAgentId: index('idx_agent_versions_agent_id').on(t.agentId),
    idxUnique: uniqueIndex('idx_agent_versions_unique').on(t.agentId, t.version),
  }),
);

export const agentSkills = pgTable(
  'agent_skills',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.skillId] }),
    idxAgentId: index('idx_agent_skills_agent_id').on(t.agentId),
    idxSkillId: index('idx_agent_skills_skill_id').on(t.skillId),
  }),
);

export type Agent = typeof agents.$inferSelect;
export type AgentVersion = typeof agentVersions.$inferSelect;
export type AgentSkill = typeof agentSkills.$inferSelect;
