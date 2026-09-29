import type { GateKind, RunStatus, StageKey, TicketStatus, TicketType, WorkflowType } from './enums.js';

/**
 * Statuses a person may set by hand (drag on the board, or the status menu).
 * Every other status is owned by a run and changes only as the run progresses.
 */
export const MANUAL_STATUSES: readonly TicketStatus[] = ['backlog', 'ready', 'cancelled'];

/** Statuses that mean a run is driving the ticket. */
export const RUN_DRIVEN_STATUSES: readonly TicketStatus[] = [
  'analysing',
  'awaiting_plan_approval',
  'building',
  'verifying',
  'awaiting_release_approval',
  'releasing',
  'blocked',
];

export const OPEN_STATUSES: readonly TicketStatus[] = [
  'backlog',
  'ready',
  ...RUN_DRIVEN_STATUSES,
];

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/** Can a person move a ticket from one status to another? */
export function checkManualMove(from: TicketStatus, to: TicketStatus, hasActiveRun: boolean): MoveCheck {
  if (from === to) return { ok: true };
  if (hasActiveRun) {
    return { ok: false, reason: 'A run is in progress on this ticket. Pause or cancel the run to change its status.' };
  }
  if (!MANUAL_STATUSES.includes(to)) {
    return { ok: false, reason: 'This column is updated by the agents while a run is in progress.' };
  }
  if (from === 'done' && to !== 'backlog') {
    return { ok: false, reason: 'Reopen a finished ticket by moving it to Backlog.' };
  }
  return { ok: true };
}

/** Ticket status shown while a run is in the given stage. */
export function statusForStage(stage: StageKey): TicketStatus {
  switch (stage) {
    case 'understand':
    case 'analyse':
    case 'plan':
      return 'analysing';
    case 'build':
      return 'building';
    case 'verify':
      return 'verifying';
    case 'release':
      return 'releasing';
  }
}

export function statusForGate(kind: GateKind): TicketStatus {
  if (kind === 'plan') return 'awaiting_plan_approval';
  if (kind === 'release') return 'awaiting_release_approval';
  return 'blocked';
}

/** Ticket status after a run reaches a terminal or waiting state. */
export function statusForRunOutcome(status: RunStatus): TicketStatus | null {
  switch (status) {
    case 'succeeded':
      return 'done';
    case 'failed':
    case 'blocked':
      return 'blocked';
    case 'cancelled':
      return 'ready';
    default:
      return null;
  }
}

/** Default workflow for each ticket type. Projects can override this in settings. */
export const DEFAULT_WORKFLOW_BY_TYPE: Record<TicketType, WorkflowType> = {
  feature: 'full_change',
  task: 'full_change',
  bug: 'hotfix',
  hotfix: 'hotfix',
  analysis: 'analysis',
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  analysing: 'Analysing',
  awaiting_plan_approval: 'Plan approval',
  building: 'Building',
  verifying: 'Verifying',
  awaiting_release_approval: 'Release approval',
  releasing: 'Releasing',
  done: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

/** Board columns, left to right. Cancelled tickets are hidden behind a filter. */
export const BOARD_COLUMNS: readonly TicketStatus[] = [
  'backlog',
  'ready',
  'analysing',
  'awaiting_plan_approval',
  'building',
  'verifying',
  'awaiting_release_approval',
  'releasing',
  'blocked',
  'done',
];
