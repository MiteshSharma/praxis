-- Enable pgvector (image: pgvector/pgvector:pg18 already has it installed)
CREATE EXTENSION IF NOT EXISTS vector;

-- Full markdown stored in Postgres (BuiltinBackend reads this directly)
ALTER TABLE repo_memories ADD COLUMN content text;

-- Chunked FTS + vector index for query-aware retrieval
CREATE TABLE memory_chunks (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  repo_key    text        NOT NULL,
  chunk_index integer     NOT NULL,
  content     text        NOT NULL,
  fts_vector  tsvector    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding   vector(1536),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_key, chunk_index)
);

CREATE INDEX idx_memory_chunks_fts       ON memory_chunks USING GIN(fts_vector);
CREATE INDEX idx_memory_chunks_repo_key  ON memory_chunks(repo_key);
CREATE INDEX idx_memory_chunks_embedding ON memory_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding IS NOT NULL;
