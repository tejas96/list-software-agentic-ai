/**
 * Realtime events. Producers (API and worker) write them to Postgres with
 * pg_notify on EVENTS_CHANNEL; the API relays them to browsers over Socket.IO,
 * into rooms `project:<id>`, `ticket:<id>`, `run:<id>` and `user:<id>`.
 * Payloads are small; clients refetch details through the REST API.
 */
export const EVENTS_CHANNEL = 'lsa_events';

export type RealtimeEvent =
  | { type: 'ticket.changed'; projectId: string; ticketId: string }
  | { type: 'ticket.created'; projectId: string; ticketId: string }
  | { type: 'comment.added'; projectId: string; ticketId: string; commentId: string }
  | { type: 'activity.added'; projectId: string; ticketId: string | null; runId: string | null; activityId: string }
  | { type: 'run.changed'; projectId: string; ticketId: string; runId: string }
  | { type: 'step.changed'; projectId: string; ticketId: string; runId: string; stepId: string }
  | { type: 'gate.changed'; projectId: string; ticketId: string; runId: string; gateId: string }
  | { type: 'source.changed'; projectId: string; sourceId: string }
  | { type: 'notification.added'; userId: string; notificationId: string };

export function eventRooms(e: RealtimeEvent): string[] {
  if (e.type === 'notification.added') return [`user:${e.userId}`];
  const rooms = [`project:${e.projectId}`, 'workspace'];
  if ('ticketId' in e && e.ticketId) rooms.push(`ticket:${e.ticketId}`);
  if ('runId' in e && e.runId) rooms.push(`run:${e.runId}`);
  return rooms;
}

/** Activity types written to the append-only audit trail. */
export const ACTIVITY_TYPES = [
  'ticket.created',
  'ticket.updated',
  'ticket.moved',
  'ticket.triaged',
  'ticket.duplicate_flagged',
  'comment.added',
  'run.started',
  'run.stage_started',
  'run.paused',
  'run.resumed',
  'run.cancelled',
  'run.succeeded',
  'run.failed',
  'run.blocked',
  'run.retried',
  'step.started',
  'step.progress',
  'step.succeeded',
  'step.failed',
  'artifact.created',
  'gate.opened',
  'gate.decided',
  'qa.failed',
  'qa.passed',
  'defect.logged',
  'defect.resolved',
  'budget.exceeded',
  'project.created',
  'project.updated',
  'member.added',
  'member.updated',
  'member.removed',
  'source.created',
  'source.synced',
  'source.failed',
  'credential.created',
  'credential.deleted',
  'user.created',
  'user.updated',
  'user.login',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
