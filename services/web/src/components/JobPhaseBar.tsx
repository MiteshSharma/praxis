import { Steps } from 'antd';
import type { JobStatus } from '@shared/contracts';

/**
 * Maps job statuses to a 0-based phase index.
 *
 * Phase index:
 *   0 = Planning
 *   1 = Plan review
 *   2 = Executing
 *   3 = Publishing PR
 *   4 = Learning
 *   5 = Done
 *
 * For `preparing` (a transient glue state used throughout the lifecycle):
 *   - Before first step runs: phase 0 (haven't done anything yet)
 *   - After plan_review (approved) / between execute steps: phase 2
 *   - After all steps complete, about to publish: phase 3
 *
 * Because we can't distinguish which "preparing" we're in from the status
 * alone, we keep it at phase 2 — the worst-case inaccuracy is a brief flash
 * (< 1 s) that users won't notice.
 */
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
  failed: -2, // special: handled below
};

const PHASE_TITLES = [
  'Planning',
  'Plan review',
  'Executing',
  'Publishing PR',
  'Learning',
  'Done',
];

type StepStatus = 'finish' | 'process' | 'wait' | 'error';

function buildItems(jobStatus: JobStatus) {
  const currentPhase = STATUS_TO_PHASE[jobStatus] ?? -1;

  return PHASE_TITLES.map((title, idx) => {
    let status: StepStatus;

    if (jobStatus === 'plan_rejected') {
      // Plan review is where the rejection happens
      if (idx < 1) status = 'finish';
      else if (idx === 1) status = 'error';
      else status = 'wait';
    } else if (jobStatus === 'failed') {
      // Keep completed phases green, current phase red, rest gray
      if (idx < currentPhase) status = 'finish';
      else if (idx === currentPhase) status = 'error';
      else status = 'wait';
    } else if (currentPhase === 5) {
      // completed — everything green
      status = 'finish';
    } else if (idx < currentPhase) {
      status = 'finish';
    } else if (idx === currentPhase) {
      status = 'process';
    } else {
      status = 'wait';
    }

    return { key: String(idx), title, status };
  });
}

interface JobPhaseBarProps {
  status: JobStatus;
}

export function JobPhaseBar({ status }: JobPhaseBarProps) {
  return (
    <Steps
      size="small"
      items={buildItems(status)}
      style={{ padding: '12px 16px', background: '#fff', borderRadius: 8 }}
    />
  );
}
