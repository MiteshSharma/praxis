-- Add model column to conversations (null = use system default)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS model text;

-- Add model column to jobs (null = inherit from conversation or use system default)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS model text;
