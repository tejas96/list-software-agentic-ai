import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  ARTIFACT_LABELS,
  resolveProjectSettings,
  roleAllows,
  TERMINAL_RUN_STATUSES,
  workflowIds,
  type ArtifactDto,
  type ControlAction,
  type GateDto,
  type RunDetailDto,
  type RunSummaryDto,
  type StartRunRequest,
  type WorkflowType,
} from '@lsa/contracts';
import { appendActivity, artifacts, gates, projects, publish, runs, runSteps, tickets, users } from '@lsa/db';
import { setTicketStatus } from '@lsa/domain';
import { AccessService } from '../common/access.service.js';
import type { SessionUser } from '../common/auth.js';
import { AppError, conflict, invalid, notFound } from '../common/errors.js';
import { Database } from '../infra/database.js';
import { TemporalService } from '../infra/temporal.service.js';
import { selectRunSummaries } from '../tickets/queries.js';

const decider = alias(users, 'decider');

@Injectable()
export class RunsService {
  private readonly logger = new Logger('Runs');

  constructor(
    private readonly database: Database,
    private readonly access: AccessService,
    private readonly temporal: TemporalService,
  ) {}

  async start(user: SessionUser, req: StartRunRequest): Promise<RunSummaryDto> {
    const db = this.database.db;
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, req.ticketId));
    if (!ticket) throw notFound('Ticket');
    await this.access.require(user, ticket.projectId, 'run.start');
    if (ticket.status === 'done' || ticket.status === 'cancelled') {
      throw invalid('This ticket is closed. Move it back to Backlog to work on it again.');
    }
    if (ticket.activeRunId) throw conflict('This ticket already has a run in progress');
    if (ticket.duplicateOfId) {
      throw invalid('This ticket is marked as a possible duplicate. Clear the duplicate flag or cancel it before starting a run.');
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, ticket.projectId));
    const settings = resolveProjectSettings(project!.settings);
    const workflowType: WorkflowType = req.workflowType ?? settings.workflowByType[ticket.type];
    const runId = crypto.randomUUID();
    const previousStatus = ticket.status;

    await db.transaction(async (tx) => {
      await tx.insert(runs).values({
        id: runId,
        ticketId: ticket.id,
        projectId: ticket.projectId,
        workflowType,
        status: 'queued',
        temporalWorkflowId: workflowIds.run(runId),
        config: settings,
        startedById: user.id,
      });
      await tx.update(tickets).set({ activeRunId: runId }).where(eq(tickets.id, ticket.id));
      await appendActivity(tx, {
        projectId: ticket.projectId,
        ticketId: ticket.id,
        runId,
        actorType: 'user',
        actorId: user.id,
        type: 'run.started',
        summary: `${user.name} started a ${workflowType.replace('_', ' ')} run`,
        data: { workflowType },
      });
      await setTicketStatus(tx, ticket.id, 'analysing', { type: 'user', userId: user.id }, { reason: 'run started', runId });
      await publish(tx, { type: 'run.changed', projectId: ticket.projectId, ticketId: ticket.id, runId });
    });

    try {
      await this.temporal.startRun(runId);
    } catch (err) {
      this.logger.error(`Could not start workflow for run ${runId}: ${(err as Error).message}`);
      await db.transaction(async (tx) => {
        await tx
          .update(runs)
          .set({ status: 'failed', error: 'The workflow engine could not be reached. Start the run again.', finishedAt: new Date() })
          .where(eq(runs.id, runId));
        await tx.update(tickets).set({ activeRunId: null }).where(eq(tickets.id, ticket.id));
        await appendActivity(tx, {
          projectId: ticket.projectId,
          ticketId: ticket.id,
          runId,
          actorType: 'system',
          type: 'run.failed',
          summary: 'Run could not start: the workflow engine is not reachable',
        });
        await setTicketStatus(tx, ticket.id, previousStatus === 'backlog' ? 'backlog' : 'ready', { type: 'system' }, { reason: 'run could not start', runId });
      });
      throw new AppError(503, 'unavailable', 'The workflow engine is not reachable, so the run could not start. Try again in a moment.');
    }
    const [summary] = await selectRunSummaries(db, eq(runs.id, runId), 1);
    return summary!;
  }

  private async loadRun(user: SessionUser, runId: string) {
    const [run] = await this.database.db.select().from(runs).where(eq(runs.id, runId));
    if (!run) throw notFound('Run');
    const role = await this.access.require(user, run.projectId, 'project.view');
    return { run, role };
  }

  async detail(user: SessionUser, runId: string): Promise<RunDetailDto> {
    const db = this.database.db;
    const { run } = await this.loadRun(user, runId);
    const [summary] = await selectRunSummaries(db, eq(runs.id, runId), 1);
    const [ticket] = await db.select({ title: tickets.title }).from(tickets).where(eq(tickets.id, run.ticketId));
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.createdAt));
    const arts = await db
      .select({ id: artifacts.id, kind: artifacts.kind, title: artifacts.title, agentKey: artifacts.agentKey, version: artifacts.version, createdAt: artifacts.createdAt })
      .from(artifacts)
      .where(eq(artifacts.runId, runId))
      .orderBy(asc(artifacts.createdAt));
    return {
      ...summary!,
      ticketTitle: ticket?.title ?? '',
      steps: steps.map((s) => ({
        id: s.id,
        stage: s.stage,
        task: s.task as RunDetailDto['steps'][number]['task'],
        agentKey: s.agentKey,
        title: s.title,
        status: s.status,
        attempt: s.attempt,
        progress: s.progress,
        currentAction: s.currentAction,
        error: s.error,
        artifactId: s.artifactId,
        costUsd: Number(s.costUsd),
        startedAt: s.startedAt?.toISOString() ?? null,
        finishedAt: s.finishedAt?.toISOString() ?? null,
      })),
      gates: await this.gatesFor(user, eq(gates.runId, runId)),
      artifacts: arts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      planRevisions: run.planRevisions,
      qaAttempts: run.qaAttempts,
      branch: run.branch,
      tokens: { input: run.tokensIn, output: run.tokensOut },
    };
  }

  async listForTicket(user: SessionUser, ticketId: string): Promise<RunSummaryDto[]> {
    const [t] = await this.database.db.select({ projectId: tickets.projectId }).from(tickets).where(eq(tickets.id, ticketId));
    if (!t) throw notFound('Ticket');
    await this.access.require(user, t.projectId, 'project.view');
    return selectRunSummaries(this.database.db, eq(runs.ticketId, ticketId));
  }

  async listActive(user: SessionUser): Promise<RunSummaryDto[]> {
    const visible = await this.access.visibleProjectIds(user);
    const active = inArray(runs.status, ['queued', 'running', 'awaiting_approval', 'paused', 'blocked']);
    if (visible !== null && visible.length === 0) return [];
    return selectRunSummaries(this.database.db, visible === null ? active : and(active, inArray(runs.projectId, visible)));
  }

  async control(user: SessionUser, runId: string, action: ControlAction, note: string | null): Promise<RunSummaryDto> {
    const { run } = await this.loadRun(user, runId);
    await this.access.require(user, run.projectId, 'run.control');
    if (TERMINAL_RUN_STATUSES.includes(run.status)) throw invalid('This run has already finished');
    const allowed: Record<ControlAction, string[]> = {
      pause: ['queued', 'running', 'awaiting_approval'],
      resume: ['paused'],
      cancel: ['queued', 'running', 'awaiting_approval', 'paused', 'blocked'],
      retry: ['blocked'],
    };
    if (!allowed[action].includes(run.status)) {
      throw invalid(`You cannot ${action} a run that is ${run.status.replace('_', ' ')}`);
    }
    const delivered = await this.temporal.signalControl(runId, { action, userId: user.id, note });
    if (!delivered) {
      if (action !== 'cancel') throw conflict('The workflow for this run no longer exists. Cancel the run and start a new one.');
      // Reconcile a run whose workflow is gone: close it in the database.
      await this.database.db.transaction(async (tx) => {
        await tx.update(runs).set({ status: 'cancelled', finishedAt: new Date(), error: note }).where(eq(runs.id, runId));
        await tx.update(gates).set({ status: 'cancelled' }).where(and(eq(gates.runId, runId), eq(gates.status, 'pending')));
        await tx.update(tickets).set({ activeRunId: null }).where(eq(tickets.id, run.ticketId));
        await appendActivity(tx, {
          projectId: run.projectId,
          ticketId: run.ticketId,
          runId,
          actorType: 'user',
          actorId: user.id,
          type: 'run.cancelled',
          summary: `${user.name} cancelled the run`,
          data: { note },
        });
        await setTicketStatus(tx, run.ticketId, 'ready', { type: 'user', userId: user.id }, { reason: 'run cancelled', runId });
        await publish(tx, { type: 'run.changed', projectId: run.projectId, ticketId: run.ticketId, runId });
      });
    }
    const [summary] = await selectRunSummaries(this.database.db, eq(runs.id, runId), 1);
    return summary!;
  }

  async artifact(user: SessionUser, artifactId: string): Promise<ArtifactDto> {
    const [a] = await this.database.db.select().from(artifacts).where(eq(artifacts.id, artifactId));
    if (!a) throw notFound('Artifact');
    const [t] = await this.database.db.select({ projectId: tickets.projectId }).from(tickets).where(eq(tickets.id, a.ticketId));
    await this.access.require(user, t!.projectId, 'project.view');
    return {
      id: a.id,
      kind: a.kind,
      title: a.title || ARTIFACT_LABELS[a.kind],
      agentKey: a.agentKey,
      version: a.version,
      createdAt: a.createdAt.toISOString(),
      runId: a.runId,
      ticketId: a.ticketId,
      content: a.content,
    };
  }

  /** Gates as DTOs, with whether this user may decide each one and why not. */
  async gatesFor(user: SessionUser, where: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<GateDto[]> {
    const db = this.database.db;
    const rows = await db
      .select({
        g: gates,
        ticketKey: tickets.key,
        ticketTitle: tickets.title,
        reporterId: tickets.reporterId,
        projectKey: projects.key,
        startedById: runs.startedById,
        dId: decider.id,
        dName: decider.name,
        dEmail: decider.email,
      })
      .from(gates)
      .innerJoin(tickets, eq(tickets.id, gates.ticketId))
      .innerJoin(projects, eq(projects.id, gates.projectId))
      .innerJoin(runs, eq(runs.id, gates.runId))
      .leftJoin(decider, eq(decider.id, gates.decidedById))
      .where(where)
      .orderBy(desc(gates.requestedAt));
    const roleCache = new Map<string, Awaited<ReturnType<AccessService['roleIn']>>>();
    const out: GateDto[] = [];
    for (const r of rows) {
      if (!roleCache.has(r.g.projectId)) roleCache.set(r.g.projectId, await this.access.roleIn(user, r.g.projectId));
      const role = roleCache.get(r.g.projectId) ?? null;
      const [p] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.id, r.g.projectId));
      const settings = resolveProjectSettings(p?.settings);
      let reason: string | null = null;
      if (r.g.status !== 'pending') reason = 'Already decided';
      else if (!roleAllows(role, 'gate.decide')) reason = 'Only approvers can decide at a gate in this project';
      else if (settings.requireIndependentApprover && (user.id === r.reporterId || user.id === r.startedById)) {
        reason = 'This project requires an approver who did not request the change or start the run';
      }
      out.push({
        id: r.g.id,
        runId: r.g.runId,
        ticketId: r.g.ticketId,
        ticketKey: r.ticketKey,
        ticketTitle: r.ticketTitle,
        projectId: r.g.projectId,
        projectKey: r.projectKey,
        kind: r.g.kind,
        status: r.g.status,
        summary: r.g.summary,
        requestedAt: r.g.requestedAt.toISOString(),
        decidedBy: r.dId ? { id: r.dId, name: r.dName!, email: r.dEmail! } : null,
        decidedAt: r.g.decidedAt?.toISOString() ?? null,
        note: r.g.note,
        canDecide: reason === null,
        cannotDecideReason: reason,
      });
    }
    return out;
  }

  /** Total spend for dashboards. */
  async costSince(projectIds: string[] | null, since: Date): Promise<number> {
    const where = projectIds === null ? sql`started_at >= ${since}` : sql`started_at >= ${since} and project_id in ${projectIds.length ? projectIds : ['00000000-0000-0000-0000-000000000000']}`;
    const res = await this.database.db.execute<{ total: string | null }>(sql`select sum(cost_usd) as total from runs where ${where}`);
    return Number(res.rows[0]?.total ?? 0);
  }
}
