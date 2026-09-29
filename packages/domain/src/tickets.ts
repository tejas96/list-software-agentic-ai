import { and, eq, max, min, sql } from 'drizzle-orm';
import {
  RANK_STEP,
  STATUS_LABELS,
  type AcceptanceCriterion,
  type TicketPriority,
  type TicketSource,
  type TicketStatus,
  type TicketType,
} from '@lsa/contracts';
import { appendActivity, projects, publish, tickets, type DbOrTx } from '@lsa/db';
import { actorFields, DomainError, type Actor } from './actor.js';

export type TicketRow = typeof tickets.$inferSelect;

export interface NewTicket {
  projectId: string;
  title: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
  labels: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  source: TicketSource;
  status: TicketStatus;
  reporterId: string | null;
  assigneeId?: string | null;
  parentId?: string | null;
  dueDate?: string | null;
  externalRef?: string | null;
  triageState?: 'pending' | 'done' | 'skipped' | 'failed';
  triageNote?: string | null;
}

/** Rank that places a ticket at the bottom of a board column. */
export async function bottomRank(tx: DbOrTx, projectId: string, status: TicketStatus): Promise<number> {
  const [row] = await tx
    .select({ top: max(tickets.rank) })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), eq(tickets.status, status)));
  return (row?.top ?? 0) + RANK_STEP;
}

/** Rank that places a ticket at the top of a board column. */
export async function topRank(tx: DbOrTx, projectId: string, status: TicketStatus): Promise<number> {
  const [row] = await tx
    .select({ low: min(tickets.rank) })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), eq(tickets.status, status)));
  return row?.low === null || row?.low === undefined ? RANK_STEP : row.low - RANK_STEP;
}

/**
 * Create a ticket with the next number in its project (e.g. BNK-42).
 * The project row is locked by the UPDATE, so numbers never collide.
 */
export async function createTicket(tx: DbOrTx, input: NewTicket, actor: Actor): Promise<TicketRow> {
  const [proj] = await tx
    .update(projects)
    .set({ ticketSeq: sql`${projects.ticketSeq} + 1` })
    .where(eq(projects.id, input.projectId))
    .returning({ seq: projects.ticketSeq, key: projects.key, archivedAt: projects.archivedAt });
  if (!proj) throw new DomainError('not_found', 'Project not found');
  if (proj.archivedAt) throw new DomainError('invalid', 'This project is archived. Restore it to add tickets.');

  const rank = await topRank(tx, input.projectId, input.status);
  const [row] = await tx
    .insert(tickets)
    .values({
      projectId: input.projectId,
      number: proj.seq,
      key: `${proj.key}-${proj.seq}`,
      type: input.type,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      status: input.status,
      priority: input.priority,
      labels: input.labels,
      source: input.source,
      externalRef: input.externalRef ?? null,
      reporterId: input.reporterId,
      assigneeId: input.assigneeId ?? null,
      parentId: input.parentId ?? null,
      dueDate: input.dueDate ?? null,
      rank,
      triageState: input.triageState ?? 'skipped',
      triageNote: input.triageNote ?? null,
    })
    .returning();
  const ticket = row!;

  await appendActivity(tx, {
    projectId: ticket.projectId,
    ticketId: ticket.id,
    ...actorFields(actor),
    type: 'ticket.created',
    summary: `Logged ${ticket.key}: ${ticket.title}`,
    data: { key: ticket.key, type: ticket.type, priority: ticket.priority, source: ticket.source, status: ticket.status },
  });
  await publish(tx, { type: 'ticket.created', projectId: ticket.projectId, ticketId: ticket.id });
  return ticket;
}

/**
 * Change a ticket's status as part of a run or a permitted manual move.
 * Callers are responsible for checking permission and lifecycle rules first.
 */
export async function setTicketStatus(
  tx: DbOrTx,
  ticketId: string,
  status: TicketStatus,
  actor: Actor,
  options: { reason?: string; rank?: number; runId?: string | null } = {},
): Promise<TicketRow> {
  const [current] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
  if (!current) throw new DomainError('not_found', 'Ticket not found');
  if (current.status === status && options.rank === undefined) return current;

  const rank = options.rank ?? (await topRank(tx, current.projectId, status));
  const closing = status === 'done' || status === 'cancelled';
  const [updated] = await tx
    .update(tickets)
    .set({
      status,
      rank,
      version: sql`${tickets.version} + 1`,
      closedAt: closing ? new Date() : null,
    })
    .where(eq(tickets.id, ticketId))
    .returning();

  if (current.status !== status) {
    const reason = options.reason ? ` (${options.reason})` : '';
    await appendActivity(tx, {
      projectId: current.projectId,
      ticketId,
      runId: options.runId ?? null,
      ...actorFields(actor),
      type: 'ticket.moved',
      summary: `Moved from ${STATUS_LABELS[current.status]} to ${STATUS_LABELS[status]}${reason}`,
      data: { from: current.status, to: status, reason: options.reason ?? null },
    });
  }
  await publish(tx, { type: 'ticket.changed', projectId: current.projectId, ticketId });
  return updated!;
}
