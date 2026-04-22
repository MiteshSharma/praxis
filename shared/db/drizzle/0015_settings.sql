-- Phase: Global settings store
-- Provides runtime-configurable settings with defaults (no restart needed).
-- Initial keys: learning_model, report_model (auxiliary LLM passes).

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed defaults so the settings page shows values immediately.
INSERT INTO settings (key, value) VALUES
  ('learning_model', 'claude-haiku-4-5-20251001'),
  ('report_model',   'claude-haiku-4-5-20251001');
