-- Add plan hold duration (hours) to conversations, default 24h
ALTER TABLE conversations ADD COLUMN plan_hold_hours integer NOT NULL DEFAULT 24;

-- Per-conversation plan review notification channels
CREATE TABLE plan_review_channels (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  type text NOT NULL,  -- 'webhook' (more types added later)
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_plan_review_channels_conv ON plan_review_channels(conversation_id);
