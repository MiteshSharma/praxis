import type { JobStatus } from '@shared/contracts';

const STATUS_TO_PHASE: Record<JobStatus, number> = {
  queued: -1,
  provisioning: -1,
  preparing: 2,
  building: 0,
  plan_ready: 1,
  plan_review: 1,
  plan_revising: 0,
  plan_rejected: 1,
  executing: 2,
  checking: 2,
  publishing: 3,
  learning: 4,
  completed: 5,
  failed: -2,
};

const PHASES = ['Planning', 'Plan review', 'Executing', 'Publishing', 'Learning', 'Done'];

type PhaseState = 'done' | 'active' | 'error' | 'wait';

function getPhaseStates(status: JobStatus): PhaseState[] {
  const current = STATUS_TO_PHASE[status] ?? -1;

  return PHASES.map((_, idx) => {
    if (status === 'plan_rejected') {
      if (idx < 1) return 'done';
      if (idx === 1) return 'error';
      return 'wait';
    }
    if (status === 'failed') {
      if (idx < current) return 'done';
      if (idx === current) return 'error';
      return 'wait';
    }
    if (current === 5) return 'done';
    if (idx < current) return 'done';
    if (idx === current) return 'active';
    return 'wait';
  });
}

interface JobPhaseBarProps {
  status: JobStatus;
}

export function JobPhaseBar({ status }: JobPhaseBarProps) {
  const states = getPhaseStates(status);

  return (
    <div className="phase-bar">
      {PHASES.map((label, idx) => (
        <div key={label} className="phase-item">
          <div className="phase-step">
            <div className={`phase-dot ${states[idx]}`}>
              {states[idx] === 'done' ? '✓' : states[idx] === 'error' ? '✕' : idx + 1}
            </div>
            <span className={`phase-label ${states[idx]}`}>{label}</span>
          </div>
          {idx < PHASES.length - 1 && (
            <div
              className={`phase-connector ${states[idx] === 'done' ? 'done' : states[idx] === 'active' ? 'active' : 'wait'}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
