-- Phase 1: execution-core tables.
-- uuidv7() is native in PostgreSQL 18 — no extension needed.
-- pgvector is intentionally NOT enabled.

CREATE TABLE IF NOT EXISTS jobs (
  id                       uuid         PRIMARY KEY DEFAULT uuidv7(),
  conversation_id          uuid,

  -- Source / ingress
  source                   text         NOT NULL,
  external_id              text,
  external_url             text,
  title                    text         NOT NULL,
  description              text,
  metadata                 jsonb        NOT NULL DEFAULT '{}'::jsonb,
  trigger_kind             text         NOT NULL DEFAULT 'user_prompt',

  -- Lineage and workflow
  parent_job_id            uuid         REFERENCES jobs(id),
  workflow_id              uuid,
  workflow_version_id      uuid,
  disable_learning         boolean      NOT NULL DEFAULT false,

  -- Repo context
  github_url               text         NOT NULL,
  github_branch            text         NOT NULL DEFAULT 'main',
  github_commit_sha        text,

  -- Execution state
  status                   text         NOT NULL,
  current_step_index       integer,
  auto_approve             boolean      NOT NULL DEFAULT false,
  plan_review_hold_until   timestamptz,
  plan_revision_count      integer      NOT NULL DEFAULT 0,
  max_plan_revisions       integer      NOT NULL DEFAULT 5,
  retry_count              integer      NOT NULL DEFAULT 0,
  max_retries              integer      NOT NULL DEFAULT 2,
  error_message            text,
  error_category           text,

  -- Timestamps
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now(),
  started_at               timestamptz,
  completed_at             timestamptz
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_conversation_id_created_at ON jobs(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_parent_job_id ON jobs(parent_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_external_id ON jobs(source, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_timeline (
  id          bigserial    PRIMARY KEY,
  job_id      uuid         NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq         integer      NOT NULL,
  type        text         NOT NULL,
  payload     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (job_id, seq)
);

CREATE TABLE IF NOT EXISTS job_steps (
  id             uuid         PRIMARY KEY DEFAULT uuidv7(),
  job_id         uuid         NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step_index     integer      NOT NULL,
  retry_of       uuid         REFERENCES job_steps(id),
  kind           text         NOT NULL,
  name           text         NOT NULL,
  config         jsonb        NOT NULL,
  status         text         NOT NULL DEFAULT 'pending',
  depends_on     jsonb,
  started_at     timestamptz,
  completed_at   timestamptz,
  output         jsonb,
  error_message  text
);

CREATE INDEX IF NOT EXISTS idx_job_steps_job_id_step_index ON job_steps(job_id, step_index, id);

CREATE TABLE IF NOT EXISTS sandboxes (
  id             uuid         PRIMARY KEY DEFAULT uuidv7(),
  job_id         uuid         NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider_id    text         NOT NULL,
  status         text         NOT NULL,
  endpoint       text,
  held_until     timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  destroyed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sandboxes_job_id ON sandboxes(job_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id          uuid         PRIMARY KEY DEFAULT uuidv7(),
  job_id      uuid         NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step_id     uuid         REFERENCES job_steps(id),
  kind        text         NOT NULL,
  path        text,
  url         text,
  metadata    jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_job_id ON artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_job_id_kind ON artifacts(job_id, kind);
