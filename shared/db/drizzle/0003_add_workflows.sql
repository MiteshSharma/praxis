-- Phase 3: agents, agent_versions, workflows, workflow_versions tables.
-- jobs.workflow_id / workflow_version_id / disable_learning were already added
-- in 0001 as nullable forward-compat columns.

CREATE TABLE IF NOT EXISTS agents (
  id           uuid         PRIMARY KEY DEFAULT uuidv7(),
  name         text         NOT NULL,
  description  text         NOT NULL DEFAULT '',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_versions (
  id            uuid         PRIMARY KEY DEFAULT uuidv7(),
  agent_id      uuid         NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version       integer      NOT NULL,
  source        text         NOT NULL,          -- 'inline' | 'github'
  content_uri   text         NOT NULL,          -- MinIO key or 'data:inline'
  definition    jsonb        NOT NULL,          -- AgentDefinition
  created_at    timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent_id ON agent_versions(agent_id);

CREATE TABLE IF NOT EXISTS workflows (
  id           uuid         PRIMARY KEY DEFAULT uuidv7(),
  name         text         NOT NULL,
  description  text         NOT NULL DEFAULT '',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id            uuid         PRIMARY KEY DEFAULT uuidv7(),
  workflow_id   uuid         NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version       integer      NOT NULL,
  source        text         NOT NULL,          -- 'inline' | 'github'
  content_uri   text         NOT NULL,
  definition    jsonb        NOT NULL,          -- WorkflowDefinition
  created_at    timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON workflow_versions(workflow_id);
