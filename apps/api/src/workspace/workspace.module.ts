import { Controller, Get, HttpCode, Inject, Injectable, Module, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { ActivityDto, DashboardDto, NotificationDto, WorkspaceStatusDto } from '@lsa/contracts';
import { activities, artifacts, gates, notifications, runs, tickets, verifyActivityChain } from '@lsa/db';
import { AccessService } from '../common/access.service.js';
import { AdminOnly, CurrentUser, Public, type SessionUser } from '../common/auth.js';
import { notFound } from '../common/errors.js';
import { UuidParam } from '../common/zod.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Database } from '../infra/database.js';
import { TemporalService } from '../infra/temporal.service.js';
import { GatesService, RunsModule } from '../runs/runs.module.js';
import { RunsService } from '../runs/runs.service.js';
import { selectActivities, selectTicketSummaries, visibleProjects } from '../tickets/queries.js';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly database: Database,
    private readonly access: AccessService,
    private readonly runsSvc: RunsService,
    private readonly gatesSvc: GatesService,
    private readonly temporal: TemporalService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async dashboard(user: SessionUser): Promise<DashboardDto> {
    const db = this.database.db;
    const visible = await this.access.visibleProjectIds(user);
    const inVisible = visibleProjects(visible);
    const needsMe = (await this.gatesSvc.pending(user)).filter((g) => g.canDecide);
    const myTickets = await selectTicketSummaries(
      db,
      and(inVisible, eq(tickets.assigneeId, user.id), inArray(tickets.status, ['backlog', 'ready', 'analysing', 'awaiting_plan_approval', 'building', 'verifying', 'awaiting_release_approval', 'releasing', 'blocked'])),
      20,
    );
    const blocked = await selectTicketSummaries(db, and(inVisible, eq(tickets.status, 'blocked')), 20);
    const activeRuns = await this.runsSvc.listActive(user);
    const actScope = visible === null ? undefined : visible.length ? inArray(activities.projectId, visible) : sql`false`;
    const recent: ActivityDto[] = await selectActivities(db, and(actScope, ne(activities.type, 'step.progress')), 25, true);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [totals] = await db
      .select({
        open: sql<number>`count(*) filter (where ${tickets.status} not in ('done','cancelled'))::int`,
        inProgress: sql<number>`count(*) filter (where ${tickets.status} in ('analysing','building','verifying','releasing'))::int`,
        awaitingApproval: sql<number>`count(*) filter (where ${tickets.status} in ('awaiting_plan_approval','awaiting_release_approval'))::int`,
        blocked: sql<number>`count(*) filter (where ${tickets.status} = 'blocked')::int`,
        doneThisWeek: sql<number>`count(*) filter (where ${tickets.status} = 'done' and ${tickets.closedAt} >= ${weekAgo})::int`,
      })
      .from(tickets)
      .where(inVisible);
    return { needsMe, myTickets, activeRuns, blocked, recent, totals: totals! };
  }

  async status(): Promise<WorkspaceStatusDto> {
    return {
      llm: { configured: Boolean(this.config.ANTHROPIC_API_KEY), model: this.config.LLM_MODEL, provider: 'anthropic' },
      embeddings: {
        provider: this.config.EMBEDDINGS_PROVIDER,
        configured: this.config.EMBEDDINGS_PROVIDER === 'none' || Boolean(this.config.VOYAGE_API_KEY),
      },
      temporal: { connected: await this.temporal.isConnected() },
      oracleTooling: { forms: Boolean(this.config.ORACLE_FORMS_BIN_DIR), reports: Boolean(this.config.ORACLE_REPORTS_BIN_DIR) },
    };
  }

  /* ------------------------------------------------------- notifications */

  async notifications(user: SessionUser, unreadOnly: boolean): Promise<{ items: NotificationDto[]; unread: number }> {
    const db = this.database.db;
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), unreadOnly ? isNull(notifications.readAt) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [c] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return {
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      unread: c?.n ?? 0,
    };
  }

  async markRead(user: SessionUser, id: string | null): Promise<void> {
    await this.database.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
  }

  /* ------------------------------------------------------------ evidence */

  /** Everything recorded for one ticket: the audit trail, artifacts and approvals. */
  async evidence(user: SessionUser, ticketIdOrKey: string) {
    const db = this.database.db;
    const isUuid = /^[0-9a-f-]{36}$/i.test(ticketIdOrKey);
    const [t] = await db.select().from(tickets).where(isUuid ? eq(tickets.id, ticketIdOrKey) : eq(tickets.key, ticketIdOrKey.toUpperCase()));
    if (!t) throw notFound('Ticket');
    await this.access.require(user, t.projectId, 'project.view');
    const trail = await selectActivities(db, eq(activities.ticketId, t.id), 5000);
    const arts = await db.select().from(artifacts).where(eq(artifacts.ticketId, t.id)).orderBy(artifacts.createdAt);
    const approvals = await this.runsSvc.gatesFor(user, eq(gates.ticketId, t.id));
    const runRows = await db.select().from(runs).where(eq(runs.ticketId, t.id)).orderBy(runs.startedAt);
    return {
      ticket: { id: t.id, key: t.key, title: t.title, type: t.type, status: t.status, createdAt: t.createdAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null },
      runs: runRows.map((r) => ({ id: r.id, workflowType: r.workflowType, status: r.status, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, costUsd: Number(r.costUsd), branch: r.branch })),
      approvals,
      artifacts: arts.map((a) => ({ id: a.id, kind: a.kind, title: a.title, agentKey: a.agentKey, version: a.version, createdAt: a.createdAt.toISOString(), content: a.content })),
      trail,
      generatedAt: new Date().toISOString(),
    };
  }

  verifyChain() {
    return verifyActivityChain(this.database.db);
  }

  async auditLog(user: SessionUser, projectId: string | undefined, before: number | undefined): Promise<ActivityDto[]> {
    const visible = await this.access.visibleProjectIds(user);
    let scope = visible === null ? undefined : visible.length ? inArray(activities.projectId, visible) : sql`false`;
    if (projectId) {
      await this.access.require(user, projectId, 'project.view');
      scope = eq(activities.projectId, projectId);
    }
    return selectActivities(this.database.db, and(scope, before ? sql`${activities.seq} < ${before}` : undefined), 200, true);
  }

  async ping(): Promise<boolean> {
    await this.database.db.execute(sql`select 1`);
    return true;
  }
}

@ApiTags('workspace')
@Controller()
export class WorkspaceController {
  constructor(private readonly svc: WorkspaceService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: SessionUser) {
    return this.svc.dashboard(user);
  }

  @Get('workspace/status')
  status() {
    return this.svc.status();
  }

  @Get('notifications')
  notifications(@CurrentUser() user: SessionUser, @Query('unread') unread?: string) {
    return this.svc.notifications(user, unread === 'true');
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: SessionUser) {
    return this.svc.markRead(user, null);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  read(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.markRead(user, id);
  }

  @Get('evidence/:ticket')
  evidence(@CurrentUser() user: SessionUser, @Query('download') download: string | undefined, @Res({ passthrough: true }) res: Response, @Param('ticket') ticket: string) {
    if (download === 'true') res.setHeader('Content-Disposition', `attachment; filename="evidence-${ticket.replace(/[^\w-]/g, '')}.json"`);
    return this.svc.evidence(user, ticket);
  }

  @Get('audit')
  audit(@CurrentUser() user: SessionUser, @Query('projectId') projectId?: string, @Query('before') before?: string) {
    return this.svc.auditLog(user, projectId || undefined, before ? Number(before) : undefined);
  }

  @AdminOnly()
  @Get('audit/verify')
  verify() {
    return this.svc.verifyChain();
  }

  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Public()
  @Get('health/ready')
  async ready() {
    await this.svc.ping();
    return { status: 'ready' };
  }
}

@Module({ imports: [RunsModule], controllers: [WorkspaceController], providers: [WorkspaceService] })
export class WorkspaceModule {}
