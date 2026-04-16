-- Add kind column to agents (distinguishes agents from skills)
ALTER TABLE agents ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'
  CHECK (kind IN ('agent', 'skill'));

-- Junction table: which skills are attached to which agents
CREATE TABLE agent_skills (
  agent_id   uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id   uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  position   int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, skill_id),
  -- sanity: agent must be kind='agent', skill must be kind='skill'
  -- enforced at application layer
  CHECK (agent_id <> skill_id)
);

CREATE INDEX idx_agent_skills_agent_id ON agent_skills(agent_id);
CREATE INDEX idx_agent_skills_skill_id ON agent_skills(skill_id);
