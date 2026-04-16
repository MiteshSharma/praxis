CREATE TABLE IF NOT EXISTS repo_memories (
  id           uuid        PRIMARY KEY DEFAULT uuidv7(),
  repo_key     text        NOT NULL UNIQUE,
  content_uri  text        NOT NULL,
  size_bytes   int         NOT NULL DEFAULT 0,
  entry_count  int         NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
