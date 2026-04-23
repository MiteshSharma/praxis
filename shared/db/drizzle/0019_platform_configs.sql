-- Phase 15: Platform config table (non-secret platform metadata).
-- Secrets (tokens, signing keys) are stored in the secrets table via the secret backend,
-- keyed as 'platform:{name}' (JSON blob per platform).

CREATE TABLE platform_configs (
  platform    TEXT        PRIMARY KEY,
  enabled     BOOLEAN     NOT NULL DEFAULT false,
  config      JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed communication_model setting used by the intent classifier.
INSERT INTO settings (key, value) VALUES
  ('communication_model', 'claude-haiku-4-5-20251001')
ON CONFLICT (key) DO NOTHING;
