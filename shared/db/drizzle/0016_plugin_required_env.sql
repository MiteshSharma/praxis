-- Phase: Plugin required env
-- Stores which env vars a plugin declares as required so the UI can
-- surface misconfigured plugins and the service can validate at create time.

ALTER TABLE plugins ADD COLUMN required_env jsonb NOT NULL DEFAULT '[]'::jsonb;
