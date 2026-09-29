import { Injectable, Logger } from '@nestjs/common';
import { and, arrayContains, asc, eq, gt, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  BOARD_COLUMNS,
  checkManualMove,
  mentionedAgents,
  needsRebalance,
  RANK_STEP,
  rankBetween,
  resolveProjectSettings,
  type ActivityDto,
  type CommentDto,
  type CreateCommentRequest,
  type CreateTicketRequest,
  type ExternalIntakeRequest,
  type IntakeRequest,
  type MoveTicketRequest,
  type TicketDto,
  type TicketListQuery,
  type TicketSource,
  type TicketSummaryDto,
  type UpdateTicketRequest,
} from '@lsa/contracts';
import { activities, appendActivity, projects, publish, runs, ticketComments, tickets, users, type Db } from '@lsa/db';
import { createTicket, setTicketStatus, type NewTicket } from '@lsa/domain';
import { AccessService } from '../common/access.service.js';
import type { SessionUser } from '../common/auth.js';
import { conflict, invalid, notFound } from '../common/errors.js';
import { Database } from '../infra/database.js';
import { TemporalService } from '../infra/temporal.service.js';
import { RunsService } from '../runs/runs.service.js';
import { selectActivities, selectComments, selectRunSummaries, selectTicketSummaries, visibleProjects } from './queries.js';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger('Tickets');

  constructor(
    private readonly database: Database,
    private readonly access: AccessService,
    private readonly temporal: TemporalService,
    private readonly runsSvc: RunsService,
  ) {}

  private get db(): Db {
    return this.database.db;
  }

  /* ------------------------------------------------------------- queries */

  async list(user: SessionUser, q: TicketListQuery): Promise<TicketSummaryDto[]> {
    const filters: (SQL | undefined)[] = [];
    if (q.projectId) {
      await this.access.require(user, q.projectId, 'project.view');
      filters.push(eq(tickets.projectId, q.projectId));
    } else {
      filters.push(visibleProjects(await this.access.visibleProjectIds(user)));
    }
    if (q.status?.length) filters.push(inArray(tickets.status, q.status));
    else if (!q.includeCancelled) filters.push(ne(tickets.status, 'cancelled'));
    if (q.type?.length) filters.push(inArray(tickets.type, q.type));
    if (q.priority?.length) filters.push(inArray(tickets.priority, q.priority));
    if (q.assigneeId === 'me') filters.push(eq(tickets.assigneeId, user.id));
    else if (q.assigneeId === 'none') filters.push(isNull(tickets.assigneeId));
    else if (q.assigneeId) filters.push(eq(tickets.assigneeId, q.assigneeId));
    if (q.label) filters.push(arrayContains(tickets.labels, [q.label]));
    if (q.mine) filters.push(or(eq(tickets.assigneeId, user.id), eq(tickets.reporterId, user.id)));
    if (q.q) {
      const term = q.q.trim();
      filters.push(
        or(
          sql`${tickets.searchVector} @@ websearch_to_tsquery('english', ${term})`,
          ilike(tickets.key, `${term.replace(/[%_]/g, '')}%`),
          ilike(tickets.title, `%${term.replace(/[%_]/g, '')}%`),
        ),
      );
    }
    return selectTicketSummaries(this.db, and(...filters), q.limit);
  }

  private async findRow(idOrKey: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
    const [t] = await this.db
      .select()
      .from(tickets)
      .where(isUuid ? eq(tickets.id, idOrKey) : eq(tickets.key, idOrKey.toUpperCase()));
    if (!t) throw notFound('Ticket');
    return t;
  }

  async get(user: SessionUser, idOrKey: string): Promise<TicketDto> {
    const t = await this.findRow(idOrKey);
    await this.access.require(user, t.projectId, 'project.view');
    const [summary] = await selectTicketSummaries(this.db, eq(tickets.id, t.id), 1);
    const [parentRow] = t.parentId
      ? await this.db.select({ id: tickets.id, key: tickets.key, title: tickets.title, status: tickets.status }).from(tickets).where(eq(tickets.id, t.parentId))
      : [];
    const [dup] = t.duplicateOfId
      ? await this.db.select({ id: tickets.id, key: tickets.key, title: tickets.title }).from(tickets).where(eq(tickets.id, t.duplicateOfId))
      : [];
    const children = await this.db
      .select({ id: tickets.id, key: tickets.key, title: tickets.title, status: tickets.status, type: tickets.type })
      .from(tickets)
      .where(eq(tickets.parentId, t.id))
      .orderBy(asc(tickets.number));
    return {
      ...summary!,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria,
      externalRef: t.externalRef,
      parent: parentRow ?? null,
      children,
      duplicateOf: dup ?? null,
      triage: { state: t.triageState, note: t.triageNote },
      runs: await selectRunSummaries(this.db, eq(runs.ticketId, t.id)),
      closedAt: t.closedAt?.toISOString() ?? null,
    };
  }

  async timeline(user: SessionUser, idOrKey: string): Promise<ActivityDto[]> {
    const t = await this.findRow(idOrKey);
    await this.access.require(user, t.projectId, 'project.view');
    return selectActivities(this.db, eq(activities.ticketId, t.id), 1000);
  }

  async comments(user: SessionUser, idOrKey: string): Promise<CommentDto[]> {
    const t = await this.findRow(idOrKey);
    await this.access.require(user, t.projectId, 'project.view');
    return selectComments(this.db, t.id);
  }

  /** Labels already used in a project, for autocomplete. */
  async labels(user: SessionUser, projectId: string): Promise<string[]> {
    await this.access.require(user, projectId, 'project.view');
    const res = await this.db.execute<{ label: string }>(
      sql`select distinct unnest(labels) as label from tickets where project_id = ${projectId} order by 1 limit 200`,
    );
    return res.rows.map((r) => r.label);
  }

  /* ------------------------------------------------------------ commands */

  async create(user: SessionUser, req: CreateTicketRequest, source: TicketSource = 'board'): Promise<TicketDto> {
    await this.access.require(user, req.projectId, 'ticket.create');
    const settings = await this.settingsOf(req.projectId);
    if (req.assigneeId) await this.assertAssignable(req.projectId, req.assigneeId);
    if (req.parentId) await this.assertSameProject(req.parentId, req.projectId);
    const triage = settings.autoTriage;
    const ticket = await this.db.transaction((tx) =>
      createTicket(
        tx,
        {
          projectId: req.projectId,
          title: req.title,
          description: req.description,
          type: req.type ?? 'feature',
          priority: req.priority ?? 'medium',
          labels: normaliseLabels(req.labels),
          acceptanceCriteria: req.acceptanceCriteria,
          source,
          status: req.status,
          reporterId: user.id,
          assigneeId: req.assigneeId ?? null,
          parentId: req.parentId ?? null,
          dueDate: req.dueDate ?? null,
          triageState: triage ? 'pending' : 'skipped',
        },
        { type: 'user', userId: user.id },
      ),
    );
    await this.afterCreate(ticket.id, triage);
    if (req.startRun || (req.status === 'ready' && settings.autoStartOnReady)) {
      await this.runsSvc.start(user, { ticketId: ticket.id });
    }
    return this.get(user, ticket.id);
  }

  /** Free-text requirement from Home: logged as a ticket first, then triaged by the agents. */
  async intake(user: SessionUser, req: IntakeRequest): Promise<TicketDto> {
    const { title, description } = splitRequest(req.text);
    return this.create(
      user,
      { projectId: req.projectId, title, description, labels: [], acceptanceCriteria: [], status: req.startRun ? 'ready' : 'backlog', startRun: req.startRun },
      'home',
    );
  }

  /** Requirement pushed by another system with the project's intake token. */
  async externalIntake(projectId: string, req: ExternalIntakeRequest): Promise<{ key: string; id: string }> {
    const settings = await this.settingsOf(projectId);
    const split = splitRequest(req.text);
    let reporterId: string | null = null;
    if (req.reporterEmail) {
      const [u] = await this.db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, req.reporterEmail.toLowerCase()));
      reporterId = u?.id ?? null;
    }
    if (req.externalRef) {
      const [existing] = await this.db
        .select({ id: tickets.id, key: tickets.key })
        .from(tickets)
        .where(and(eq(tickets.projectId, projectId), eq(tickets.externalRef, req.externalRef)));
      if (existing) return existing; // idempotent re-delivery
    }
    const input: NewTicket = {
      projectId,
      title: req.title ?? split.title,
      description: req.title ? req.text : split.description,
      type: req.type ?? 'feature',
      priority: req.priority ?? 'medium',
      labels: [],
      acceptanceCriteria: [],
      source: 'intake_api',
      status: 'backlog',
      reporterId,
      externalRef: req.externalRef ?? null,
      triageState: settings.autoTriage ? 'pending' : 'skipped',
    };
    const t = await this.db.transaction((tx) => createTicket(tx, input, { type: 'system' }));
    await this.afterCreate(t.id, settings.autoTriage);
    return { key: t.key, id: t.id };
  }

  private async afterCreate(ticketId: string, triage: boolean): Promise<void> {
    if (!triage) return;
    try {
      await this.temporal.startTriage(ticketId);
    } catch (err) {
      this.logger.warn(`Triage not started for ${ticketId}: ${(err as Error).message}`);
      await this.db
        .update(tickets)
        .set({ triageState: 'skipped', triageNote: 'Triage did not run because the workflow engine was unreachable.' })
        .where(eq(tickets.id, ticketId));
    }
  }

  async update(user: SessionUser, idOrKey: string, req: UpdateTicketRequest): Promise<TicketDto> {
    const t = await this.findRow(idOrKey);
    await this.access.require(user, t.projectId, 'ticket.edit');
    if (req.assigneeId) await this.assertAssignable(t.projectId, req.assigneeId);
    const changes: Record<string, unknown> = {};
    if (req.title !== undefined && req.title !== t.title) changes.title = req.title;
    if (req.description !== undefined && req.description !== t.description) changes.description = req.description;
    if (req.type !== undefined && req.type !== t.type) changes.type = req.type;
    if (req.priority !== undefined && req.priority !== t.priority) changes.priority = req.priority;
    if (req.assigneeId !== undefined && req.assigneeId !== t.assigneeId) changes.assigneeId = req.assigneeId;
    if (req.labels !== undefined) changes.labels = normaliseLabels(req.labels);
    if (req.dueDate !== undefined && req.dueDate !== t.dueDate) changes.dueDate = req.dueDate;
    if (req.acceptanceCriteria !== undefined) changes.acceptanceCriteria = req.acceptanceCriteria;
    if (Object.keys(changes).length === 0) return this.get(user, t.id);

    await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(tickets)
        .set({ ...changes, version: sql`${tickets.version} + 1` })
        .where(and(eq(tickets.id, t.id), eq(tickets.version, req.version)))
        .returning({ id: tickets.id });
      if (!u) throw conflict('Someone else changed this ticket. Reload to see the latest version, then try again.');
      await appendActivity(tx, {
        projectId: t.projectId,
        ticketId: t.id,
        actorType: 'user',
        actorId: user.id,
        type: 'ticket.updated',
        summary: `${user.name} updated ${describeFields(Object.keys(changes))}`,
        data: { fields: Object.keys(changes), before: pick(t, Object.keys(changes)), after: changes },
      });
      await publish(tx, { type: 'ticket.changed', projectId: t.projectId, ticketId: t.id });
    });
    return this.get(user, t.id);
  }

  /** Drag and drop on the board: column change and/or reorder. */
  async move(user: SessionUser, idOrKey: string, req: MoveTicketRequest): Promise<TicketDto> {
    const t = await this.findRow(idOrKey);
    await this.access.require(user, t.projectId, 'ticket.move');
    if (t.version !== req.version) throw conflict('Someone else changed this ticket. Reload the board and try again.');
    const check = checkManualMove(t.status, req.status, t.activeRunId !== null);
    if (!check.ok) throw invalid(check.reason);
    if (!BOARD_COLUMNS.includes(req.status) && req.status !== 'cancelled') throw invalid('Unknown column');

    await this.db.transaction(async (tx) => {
      const rank = await this.rankAfter(tx as unknown as Db, t.projectId, req.status, req.afterId ?? null, t.id);
      await setTicketStatus(tx, t.id, req.status, { type: 'user', userId: user.id }, { rank });
    });

    const settings = await this.settingsOf(t.projectId);
    if (req.status === 'ready' && t.status !== 'ready' && settings.autoStartOnReady) {
      await this.runsSvc.start(user, { ticketId: t.id });
    }
    return this.get(user, t.id);
  }

  private async rankAfter(db: Db, projectId: string, status: string, afterId: string | null, selfId: string): Promise<number> {
    const col = and(eq(tickets.projectId, projectId), eq(tickets.status, status as TicketDto['status']), ne(tickets.id, selfId));
    let before: number | null = null;
    let after: number | null = null;
    if (afterId) {
      const [a] = await db.select({ rank: tickets.rank }).from(tickets).where(eq(tickets.id, afterId));
      if (!a) throw notFound('Neighbour ticket');
      before = a.rank;
      const [n] = await db.select({ rank: tickets.rank }).from(tickets).where(and(col, gt(tickets.rank, a.rank))).orderBy(asc(tickets.rank)).limit(1);
      after = n?.rank ?? null;
    } else {
      const [first] = await db.select({ rank: tickets.rank }).from(tickets).where(col).orderBy(asc(tickets.rank)).limit(1);
      after = first?.rank ?? null;
    }
    if (needsRebalance(before, after)) {
      // Re-space the column so there is room again, then recompute.
      await db.execute(sql`
        update tickets set rank = s.rn * ${RANK_STEP}
        from (select id, row_number() over (order by rank) as rn from tickets where project_id = ${projectId} and status = ${status}) s
        where tickets.id = s.id`);
      return this.rankAfter(db, projectId, status, afterId, selfId);
    }
    return rankBetween(before, after);
  }

  async addComment(user: SessionUser, idOrKey: string, req: CreateCommentRequest): Promise<CommentDto> {
    const t = await this.findRow(idOrKey);
    await this.access.require(user, t.projectId, 'ticket.comment');
    const id = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(ticketComments)
        .values({ ticketId: t.id, authorType: 'user', authorId: user.id, body: req.body })
        .returning({ id: ticketComments.id });
      await appendActivity(tx, {
        projectId: t.projectId,
        ticketId: t.id,
        actorType: 'user',
        actorId: user.id,
        type: 'comment.added',
        summary: `${user.name} commented`,
        data: { commentId: c!.id, excerpt: req.body.slice(0, 200) },
      });
      await publish(tx, { type: 'comment.added', projectId: t.projectId, ticketId: t.id, commentId: c!.id });
      return c!.id;
    });
    for (const agentKey of mentionedAgents(req.body)) {
      try {
        await this.temporal.startAgentReply(id, agentKey);
      } catch (err) {
        this.logger.warn(`Agent reply not started: ${(err as Error).message}`);
      }
    }
    const all = await selectComments(this.db, t.id);
    return all.find((c) => c.id === id)!;
  }

  /** Clear a "possible duplicate" flag set by triage. */
  async clearDuplicate(user: SessionUser, idOrKey: string): Promise<TicketDto> {
    const t = await this.findRow(idOrKey);
    await this.access.require(user, t.projectId, 'ticket.edit');
    await this.db.transaction(async (tx) => {
      await tx.update(tickets).set({ duplicateOfId: null, version: sql`${tickets.version} + 1` }).where(eq(tickets.id, t.id));
      await appendActivity(tx, {
        projectId: t.projectId,
        ticketId: t.id,
        actorType: 'user',
        actorId: user.id,
        type: 'ticket.updated',
        summary: `${user.name} confirmed this is not a duplicate`,
        data: { fields: ['duplicateOf'] },
      });
      await publish(tx, { type: 'ticket.changed', projectId: t.projectId, ticketId: t.id });
    });
    return this.get(user, t.id);
  }

  /* ------------------------------------------------------------- helpers */

  private async settingsOf(projectId: string) {
    const [p] = await this.db.select({ settings: projects.settings }).from(projects).where(eq(projects.id, projectId));
    if (!p) throw notFound('Project');
    return resolveProjectSettings(p.settings);
  }

  private async assertAssignable(projectId: string, userId: string): Promise<void> {
    const res = await this.db.execute<{ ok: boolean }>(sql`
      select exists(
        select 1 from users u
        left join project_members m on m.user_id = u.id and m.project_id = ${projectId}
        where u.id = ${userId} and u.status = 'active' and (m.user_id is not null or u.is_admin)
      ) as ok`);
    if (!res.rows[0]?.ok) throw invalid('The assignee must be an active member of this project');
  }

  private async assertSameProject(ticketId: string, projectId: string): Promise<void> {
    const [p] = await this.db.select({ projectId: tickets.projectId }).from(tickets).where(eq(tickets.id, ticketId));
    if (!p || p.projectId !== projectId) throw invalid('The parent ticket must be in the same project');
  }
}

/** First line (or sentence) becomes the title; the whole text stays as the description. */
export function splitRequest(text: string): { title: string; description: string } {
  const clean = text.trim();
  const firstLine = clean.split(/\r?\n/)[0]!.trim();
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0]!.trim();
  let title = (sentence.length >= 3 ? sentence : firstLine).replace(/[.!?]+$/, '');
  if (title.length > 160) title = `${title.slice(0, 157).trimEnd()}…`;
  if (title.length < 3) title = clean.slice(0, 160);
  return { title, description: clean };
}

function normaliseLabels(labels: string[]): string[] {
  return [...new Set(labels.map((l) => l.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 20);
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

function describeFields(fields: string[]): string {
  const names: Record<string, string> = {
    title: 'the title',
    description: 'the description',
    type: 'the type',
    priority: 'the priority',
    assigneeId: 'the assignee',
    labels: 'the labels',
    dueDate: 'the due date',
    acceptanceCriteria: 'the acceptance criteria',
  };
  const parts = fields.map((f) => names[f] ?? f);
  return parts.length <= 1 ? (parts[0] ?? 'the ticket') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

