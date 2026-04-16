-- Phase 2: plans table for plan-and-revision loop.
-- jobs columns (plan_review_hold_until, plan_revision_count, max_plan_revisions) were
-- already added in 0001 as nullable forward-compat columns.

CREATE TABLE IF NOT EXISTS plans (
  id                  uuid         PRIMARY KEY DEFAULT uuidv7(),
  job_id              uuid         NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version             integer      NOT NULL,
  previous_plan_id    uuid         REFERENCES plans(id),
  content_uri         text         NOT NULL,
  data                jsonb        NOT NULL,
  status              text         NOT NULL DEFAULT 'draft',
  feedback_from_user  text,
  approved_at         timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (job_id, version)
);

CREATE INDEX IF NOT EXISTS idx_plans_job_id_version ON plans(job_id, version DESC);
