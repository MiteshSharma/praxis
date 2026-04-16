-- Phase 4: conversations, messages, plugins tables.
-- conversations: groups of related jobs with a shared default repo + workflow
-- messages: chat thread of user/assistant turns within a conversation
-- plugins: per-conversation MCP server configs

CREATE TABLE IF NOT EXISTS conversations (
  id                   uuid         PRIMARY KEY DEFAULT uuidv7(),
  title                text         NOT NULL,
  default_github_url   text,
  default_workflow_id  uuid         REFERENCES workflows(id) ON DELETE SET NULL,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id               uuid         PRIMARY KEY DEFAULT uuidv7(),
  conversation_id  uuid         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             text         NOT NULL,   -- 'user' | 'assistant' | 'system'
  content          text         NOT NULL,
  job_id           uuid         REFERENCES jobs(id) ON DELETE SET NULL,
  metadata         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS plugins (
  id               uuid         PRIMARY KEY DEFAULT uuidv7(),
  conversation_id  uuid         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name             text         NOT NULL,
  transport        text         NOT NULL,   -- 'stdio' | 'http'
  command          text,                    -- for stdio transport
  url              text,                    -- for http transport
  env              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  enabled          boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (conversation_id, name)
);

CREATE INDEX IF NOT EXISTS idx_plugins_conversation_id ON plugins(conversation_id);

-- conversations.id was already added to jobs in 0001_init.sql as conversation_id uuid
-- Add FK constraint now that conversations table exists
ALTER TABLE jobs
  ADD CONSTRAINT fk_jobs_conversation_id
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  ON DELETE SET NULL
  NOT VALID;  -- NOT VALID skips backfill for existing NULL rows
