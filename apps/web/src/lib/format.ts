import {
  STATUS_LABELS,
  type RunStatus,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from '@lsa/contracts';

export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function money(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`;
}

export const TYPE_LABELS: Record<TicketType, string> = {
  feature: 'Feature',
  bug: 'Bug',
  hotfix: 'Hotfix',
  analysis: 'Analysis',
  task: 'Task',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export type Tone = 'ok' | 'run' | 'wait' | 'bad' | 'idle' | 'accent';

export function statusTone(s: TicketStatus): Tone {
  if (s === 'done') return 'ok';
  if (s === 'blocked') return 'bad';
  if (s === 'awaiting_plan_approval' || s === 'awaiting_release_approval') return 'wait';
  if (s === 'analysing' || s === 'building' || s === 'verifying' || s === 'releasing') return 'run';
  return 'idle';
}

export function runTone(s: RunStatus): Tone {
  if (s === 'succeeded') return 'ok';
  if (s === 'failed' || s === 'blocked') return 'bad';
  if (s === 'awaiting_approval') return 'wait';
  if (s === 'running' || s === 'queued') return 'run';
  return 'idle';
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Working',
  awaiting_approval: 'Waiting on you',
  paused: 'Paused',
  blocked: 'Needs a person',
  succeeded: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export { STATUS_LABELS };
