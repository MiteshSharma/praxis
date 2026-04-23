-- Phase 15: Platform sessions and threads for messaging channels (Slack, future platforms).
-- platform and chat_id are open TEXT columns — no enum. New platforms work without schema changes.

CREATE TABLE platform_sessions (
  id              UUID        PRIMARY KEY DEFAULT uuidv7(),
  platform        TEXT        NOT NULL,
  chat_id         TEXT        NOT NULL,
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT,
  user_name       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, chat_id)
);

CREATE INDEX idx_platform_sessions_conv ON platform_sessions(conversation_id);

-- Maps a platform message thread to a specific job for plan approval routing.
-- thread_id = platform's native thread/message ID (Slack ts, Telegram message_id, etc.)
CREATE TABLE platform_threads (
  id         UUID        PRIMARY KEY DEFAULT uuidv7(),
  platform   TEXT        NOT NULL,
  chat_id    TEXT        NOT NULL,
  thread_id  TEXT        NOT NULL,
  job_id     UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, chat_id, thread_id)
);

CREATE INDEX idx_platform_threads_job ON platform_threads(job_id);
