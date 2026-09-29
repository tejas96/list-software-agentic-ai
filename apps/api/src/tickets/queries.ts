import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { ActivityDto, CommentDto, RunSummaryDto, TicketSummaryDto, UserRefDto } from '@lsa/contracts';
import { resolveProjectSettings } from '@lsa/contracts';
import { activities, gates, projects, runs, ticketComments, tickets, users, type Db } from '@lsa/db';

const assignee = alias(users, 'assignee');
const reporter = alias(users, 'reporter');
const parent = alias(tickets, 'parent');
const activeRun = alias(runs, 'active_run');

function ref(id: string | null, name: string | null, email: string | null): UserRefDto | null {
  return id && name && email ? { id, name, email } : null;
}

/** Select tickets as board cards. `where` is combined with any extra filters by the caller. */
export async function selectTicketSummaries(
  db: Db,
  where: SQL | undefined,
  limit = 500,
): Promise<TicketSummaryDto[]> {
  const rows = await db
    .select({
      t: tickets,
      projectKey: projects.key,
      aId: assignee.id,
      aName: assignee.name,
      aEmail: assignee.email,
      rId: reporter.id,
      rName: reporter.name,
      rEmail: reporter.email,
      parentKey: parent.key,
      runId: activeRun.id,
      runStatus: activeRun.status,
      runStage: activeRun.currentStage,
      runWorkflow: activeRun.workflowType,
      pendingGate: sql<
        string | null
      >`(select g.kind from ${gates} g where g.ticket_id = ${tickets.id} and g.status = 'pending' limit 1)`,
      commentCount: sql<number>`(select count(*)::int from ${ticketComments} c where c.ticket_id = ${tickets.id})`,
      childCount: sql<number>`(select count(*)::int from ${tickets} ch where ch.parent_id = ${tickets.id})`,
    })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
    .leftJoin(reporter, eq(reporter.id, tickets.reporterId))
    .leftJoin(parent, eq(parent.id, tickets.parentId))
    .leftJoin(activeRun, eq(activeRun.id, tickets.activeRunId))
    .where(where)
    .orderBy(tickets.status, tickets.rank)
    .limit(limit);

  return rows.map((r) => ({
    id: r.t.id,
    key: r.t.key,
    projectId: r.t.projectId,
    projectKey: r.projectKey,
    title: r.t.title,
    type: r.t.type,
    status: r.t.status,
    priority: r.t.priority,
    labels: r.t.labels,
    assignee: ref(r.aId, r.aName, r.aEmail),
    reporter: ref(r.rId, r.rName, r.rEmail),
    dueDate: r.t.dueDate,
    source: r.t.source,
    rank: r.t.rank,
    version: r.t.version,
    parentKey: r.parentKey,
    activeRun: r.runId
      ? { id: r.runId, status: r.runStatus!, stage: r.runStage, workflowType: r.runWorkflow! }
      : null,
    pendingGate: (r.pendingGate as TicketSummaryDto['pendingGate']) ?? null,
    commentCount: r.commentCount,
    childCount: r.childCount,
    createdAt: r.t.createdAt.toISOString(),
    updatedAt: r.t.updatedAt.toISOString(),
  }));
}

const starter = alias(users, 'starter');

export async function selectRunSummaries(
  db: Db,
  where: SQL | undefined,
  limit = 100,
): Promise<RunSummaryDto[]> {
  const rows = await db
    .select({ r: runs, ticketKey: tickets.key, sId: starter.id, sName: starter.name, sEmail: starter.email })
    .from(runs)
    .innerJoin(tickets, eq(tickets.id, runs.ticketId))
    .leftJoin(starter, eq(starter.id, runs.startedById))
    .where(where)
    .orderBy(desc(runs.startedAt))
    .limit(limit);
  return rows.map((x) => ({
    id: x.r.id,
    ticketId: x.r.ticketId,
    ticketKey: x.ticketKey,
    projectId: x.r.projectId,
    workflowType: x.r.workflowType,
    status: x.r.status,
    currentStage: x.r.currentStage,
    startedBy: ref(x.sId, x.sName, x.sEmail),
    startedAt: x.r.startedAt.toISOString(),
    finishedAt: x.r.finishedAt?.toISOString() ?? null,
    error: x.r.error,
    costUsd: Number(x.r.costUsd),
    budgetUsd: resolveProjectSettings(x.r.config).runBudgetUsd,
  }));
}

const actor = alias(users, 'actor');

export async function selectActivities(
  db: Db,
  where: SQL | undefined,
  limit = 300,
  newestFirst = false,
): Promise<ActivityDto[]> {
  const rows = await db
    .select({ a: activities, ticketKey: tickets.key, uId: actor.id, uName: actor.name, uEmail: actor.email })
    .from(activities)
    .leftJoin(tickets, eq(tickets.id, activities.ticketId))
    .leftJoin(actor, eq(actor.id, activities.actorId))
    .where(where)
    .orderBy(newestFirst ? desc(activities.seq) : activities.seq)
    .limit(limit);
  return rows.map((x) => ({
    id: x.a.id,
    seq: Number(x.a.seq),
    hash: x.a.hash,
    projectId: x.a.projectId ?? '',
    ticketId: x.a.ticketId,
    ticketKey: x.ticketKey,
    runId: x.a.runId,
    actorType: x.a.actorType,
    actor: ref(x.uId, x.uName, x.uEmail),
    agentKey: x.a.agentKey,
    type: x.a.type,
    summary: x.a.summary,
    data: x.a.data,
    createdAt: x.a.createdAt.toISOString(),
  }));
}

const author = alias(users, 'author');

export async function selectComments(db: Db, ticketId: string): Promise<CommentDto[]> {
  const rows = await db
    .select({ c: ticketComments, uId: author.id, uName: author.name, uEmail: author.email })
    .from(ticketComments)
    .leftJoin(author, eq(author.id, ticketComments.authorId))
    .where(eq(ticketComments.ticketId, ticketId))
    .orderBy(ticketComments.createdAt);
  return rows.map((x) => ({
    id: x.c.id,
    ticketId: x.c.ticketId,
    authorType: x.c.authorType,
    author: ref(x.uId, x.uName, x.uEmail),
    agentKey: x.c.agentKey,
    body: x.c.body,
    createdAt: x.c.createdAt.toISOString(),
    editedAt: x.c.editedAt?.toISOString() ?? null,
  }));
}

/** Filter to projects the user can see (`null` = all). */
export function visibleProjects(ids: string[] | null): SQL | undefined {
  if (ids === null) return undefined;
  if (ids.length === 0) return sql`false`;
  return inArray(tickets.projectId, ids);
}

export { and, eq };
