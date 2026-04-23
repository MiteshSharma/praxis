-- Phase 13: Fleet tables

CREATE TABLE fleets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  goal            TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'fanout',
    -- 'fanout' | 'orchestrated'
  status          TEXT NOT NULL DEFAULT 'draft',
    -- draft | scouting | planning | implementing | running | completed | failed | cancelled
  plan            JSONB,
    -- orchestrated only: { currentWave: int, reasoning: string,
    --   phases: [{ type: 'scout'|'implement', sessions: [...], tasks: {...} }] }
  auto_approve    BOOLEAN NOT NULL DEFAULT false,
  max_parallel    INTEGER NOT NULL DEFAULT 10,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fleet_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id            UUID NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
  session_id          UUID NOT NULL REFERENCES conversations(id),
  session_message_id  UUID REFERENCES messages(id),
  job_type            TEXT NOT NULL DEFAULT 'implement',
    -- 'scout' | 'implement' | 'verify'
  task                TEXT NOT NULL,
  wave                INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'pending',
    -- pending | queued | running | completed | noop | failed | cancelled
  report              JSONB,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  merged              BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fleet_job_deps (
  fleet_job_id   UUID NOT NULL REFERENCES fleet_jobs(id) ON DELETE CASCADE,
  depends_on_id  UUID NOT NULL REFERENCES fleet_jobs(id) ON DELETE CASCADE,
  PRIMARY KEY (fleet_job_id, depends_on_id)
);

-- Fleet context lives on the message. messages.job_id already links message → job (latest).
-- jobs.message_id is the reverse: lets you find all jobs ever created from a message
-- (retries, future multi-job scenarios). Both directions are needed.
ALTER TABLE messages ADD COLUMN fleet_job_id UUID REFERENCES fleet_jobs(id);
ALTER TABLE jobs     ADD COLUMN message_id   UUID REFERENCES messages(id);

CREATE INDEX ON fleet_jobs(fleet_id);
CREATE INDEX ON fleet_jobs(session_id);
CREATE INDEX ON jobs(message_id) WHERE message_id IS NOT NULL;
