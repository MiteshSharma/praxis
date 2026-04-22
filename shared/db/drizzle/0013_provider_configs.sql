-- Provider configuration table.
-- API keys are NOT stored here — they live in the secrets table via the secret backend.
-- This table stores only the provider name and non-secret extra config (e.g. site_url).
CREATE TABLE provider_configs (
  provider    TEXT        PRIMARY KEY,
  config      JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
