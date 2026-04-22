-- Secret store: backend-agnostic key/value table.
-- When SECRET_BACKEND=db (default), values are stored here.
-- When using an external backend (vault, aws, gcp), this table is unused.
CREATE TABLE secrets (
  key         TEXT        PRIMARY KEY,
  value       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
