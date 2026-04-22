-- Phase 12: Fleet Foundations
-- Adds structured job output, no-op tracking, and upstream context injection.
-- These columns are independently useful in single-repo sessions and are the
-- building blocks fleet orchestration will assemble later.

ALTER TABLE jobs ADD COLUMN no_changes       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN output           JSONB;
ALTER TABLE jobs ADD COLUMN context_job_ids  JSONB;

COMMENT ON COLUMN jobs.no_changes IS
  'True when the job completed successfully but made no file changes (task did not apply to this repo).';

COMMENT ON COLUMN jobs.output IS
  'Structured JSON output from the job. Populated by the report generation pass after completion.
   Scout jobs store their findings here. Fleet master agent reads from here.';

COMMENT ON COLUMN jobs.context_job_ids IS
  'JSON array of job UUIDs whose output is injected into this job''s execute prompt.
   Allows downstream jobs to receive upstream findings without manual prompt engineering.';
