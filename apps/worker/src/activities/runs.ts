import { ApplicationFailure } from '@temporalio/activity';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  ARTIFACT_LABELS,
  resolveProjectSettings,
  statusForGate,
  statusForRunOutcome,
  statusForStage,
  type ArtifactKind,
  type GateKind,
  type GateSummary,
  type ProjectSettings,
  type RunStatus,
  type StageKey,
  type WorkflowType,
} from '@lsa/contracts';
import { appendActivity, artifacts, gates, projects, publish, runs, runSteps, tickets, type DbOrTx } from '@lsa/db';
import { createTicket, notifyUsers, projectApprovers, setTicketStatus, ticketWatchers } from '@lsa/domain';
import type { Deps } from '../deps.js';
import { removeRunWorkspace } from './workspace.js';

export interface RunInfo {
  runId: string;
  ticketId: string;
  ticketKey: string;
  projectId: string;
  workflowType: WorkflowType;
  gates: { plan: boolean; release: boolean };
  qaMaxAttempts: number;
  maxPlanRevisions: number;
}

export async function latestArtifact(db: DbOrTx, runId: string, kind: ArtifactKind) {
  const [a] = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.kind, kind)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  return a ?? null;
}

async function runRow(db: DbOrTx, runId: string) {
  const [r] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!r) throw ApplicationFailure.nonRetryable(`Run ${runId} not found`, 'NotFound');
  return r;
}

async function setRun(tx: DbOrTx, run: { id: string; projectId: string; ticketId: string }, patch: Partial<typeof runs.$inferInsert>) {
  await tx.update(runs).set(patch).where(eq(runs.id, run.id));
  await publish(tx, { type: 'run.changed', projectId: run.projectId, ticketId: run.ticketId, runId: run.id });
}

export function runActivities(deps: Deps) {
  const { db } = deps;

  return {
    async loadRun(runId: string): Promise<RunInfo> {
      const r = await runRow(db, runId);
      const [t] = await db.select({ key: tickets.key }).from(tickets).where(eq(tickets.id, r.ticketId));
      const s: ProjectSettings = resolveProjectSettings(r.config);
      return {
        runId,
        ticketId: r.ticketId,
        ticketKey: t!.key,
        projectId: r.projectId,
        workflowType: r.workflowType,
        gates: s.gates,
        qaMaxAttempts: s.qaMaxAttempts,
        maxPlanRevisions: s.maxPlanRevisions,
      };
    },

    /** Whichever worker runs this owns the run's workspace; later workspace activities go to its queue. */
    async claimHost(): Promise<string> {
      return deps.config.hostQueue;
    },

    async setRunStatus(runId: string, status: RunStatus, note?: string | null): Promise<void> {
      const r = await runRow(db, runId);
      await db.transaction(async (tx) => {
        await setRun(tx, r, { status, ...(note !== undefined && { error: note }) });
        if (status === 'paused' || status === 'running') {
          if (r.status === 'paused' || status === 'paused') {
            await appendActivity(tx, {
              projectId: r.projectId,
              ticketId: r.ticketId,
              runId,
              actorType: 'system',
              type: status === 'paused' ? 'run.paused' : 'run.resumed',
              summary: status === 'paused' ? 'Run paused' : 'Run resumed',
              data: { note: note ?? null },
            });
          }
        }
      });
    },

    async enterStage(runId: string, stage: StageKey, label: string): Promise<void> {
      const r = await runRow(db, runId);
      await db.transaction(async (tx) => {
        await setRun(tx, r, { currentStage: stage, status: 'running', error: null });
        await appendActivity(tx, {
          projectId: r.projectId,
          ticketId: r.ticketId,
          runId,
          actorType: 'system',
          type: 'run.stage_started',
          summary: `Stage started: ${label}`,
          data: { stage },
        });
        await setTicketStatus(tx, r.ticketId, statusForStage(stage), { type: 'system' }, { runId });
      });
    },

    /** Open an approval gate with a summary built from the run's artifacts, and tell the approvers. */
    async openGate(runId: string, kind: GateKind, escalation?: { reason: string; needed: string } | null): Promise<string> {
      const r = await runRow(db, runId);
      const [t] = await db.select().from(tickets).where(eq(tickets.id, r.ticketId));
      const summary = await buildGateSummary(db, runId, kind, escalation ?? null);
      return db.transaction(async (tx) => {
        // A pending gate left over from a crashed attempt is reused rather than duplicated.
        const [existing] = await tx.select().from(gates).where(and(eq(gates.runId, runId), eq(gates.status, 'pending')));
        if (existing && existing.kind === kind) return existing.id;
        if (existing) await tx.update(gates).set({ status: 'cancelled' }).where(eq(gates.id, existing.id));
        const [g] = await tx
          .insert(gates)
          .values({ runId, ticketId: r.ticketId, projectId: r.projectId, kind, summary })
          .returning({ id: gates.id });
        await setRun(tx, r, { status: kind === 'escalation' ? 'blocked' : 'awaiting_approval', error: escalation?.reason ?? null });
        await appendActivity(tx, {
          projectId: r.projectId,
          ticketId: r.ticketId,
          runId,
          actorType: 'system',
          type: kind === 'escalation' ? 'run.blocked' : 'gate.opened',
          summary: kind === 'escalation' ? `Needs a person: ${escalation?.reason}` : `${summary.headline} — waiting for an approver`,
          data: { gateId: g!.id, kind, ...(escalation ?? {}) },
        });
        await setTicketStatus(tx, r.ticketId, statusForGate(kind), { type: 'system' }, { runId });
        const approvers = await projectApprovers(tx, r.projectId);
        const recipients = kind === 'escalation' ? [...approvers, ...ticketWatchers(t!), ...(r.startedById ? [r.startedById] : [])] : approvers;
        await notifyUsers(tx, recipients, {
          type: kind === 'escalation' ? 'run.blocked' : 'gate.opened',
          title: kind === 'escalation' ? `${t!.key} needs you: ${escalation?.reason}` : `${t!.key}: ${summary.headline}`,
          body: t!.title,
          link: `/tickets/${t!.key}`,
        });
        await publish(tx, { type: 'gate.changed', projectId: r.projectId, ticketId: r.ticketId, runId, gateId: g!.id });
        return g!.id;
      });
    },

    async readGate(gateId: string): Promise<{ status: string; note: string | null; decidedById: string | null }> {
      const [g] = await db.select().from(gates).where(eq(gates.id, gateId));
      if (!g) throw ApplicationFailure.nonRetryable('Gate not found', 'NotFound');
      return { status: g.status, note: g.note, decidedById: g.decidedById };
    },

    /** Close an escalation because someone retried or cancelled the run from the run controls. */
    async resolveEscalation(gateId: string, userId: string | null, decision: 'approved' | 'rejected'): Promise<void> {
      await db.transaction(async (tx) => {
        const [g] = await tx
          .update(gates)
          .set({ status: decision, decidedById: userId, decidedAt: new Date(), note: decision === 'approved' ? 'Retried from the run controls' : 'Run cancelled' })
          .where(and(eq(gates.id, gateId), eq(gates.status, 'pending')))
          .returning();
        if (g) await publish(tx, { type: 'gate.changed', projectId: g.projectId, ticketId: g.ticketId, runId: g.runId, gateId });
      });
    },

    async recordRevision(runId: string, field: 'planRevisions' | 'qaAttempts'): Promise<number> {
      const r = await runRow(db, runId);
      const col = field === 'planRevisions' ? runs.planRevisions : runs.qaAttempts;
      const [u] = await db
        .update(runs)
        .set({ [field]: sql`${col} + 1` })
        .where(eq(runs.id, runId))
        .returning({ n: col });
      await publish(db, { type: 'run.changed', projectId: r.projectId, ticketId: r.ticketId, runId });
      return u!.n;
    },

    /**
     * Log each product defect from a failed test run as a child Bug ticket, so
     * every fix is tracked on the board. Existing open defects for the same
     * test in this run are reused.
     */
    async logDefects(runId: string, testResultsArtifactId: string): Promise<string[]> {
      const r = await runRow(db, runId);
      const [art] = await db.select().from(artifacts).where(eq(artifacts.id, testResultsArtifactId));
      const results = (art?.content as { results?: { caseId: string; title: string; status: string; details: string; failureCategory: string | null }[] })?.results ?? [];
      const failures = results.filter((x) => x.status === 'failed' && x.failureCategory === 'product_defect');
      if (failures.length === 0) return [];
      const [parent] = await db.select().from(tickets).where(eq(tickets.id, r.ticketId));
      const keys: string[] = [];
      await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: tickets.id, key: tickets.key, externalRef: tickets.externalRef, status: tickets.status })
          .from(tickets)
          .where(and(eq(tickets.parentId, r.ticketId), eq(tickets.source, 'agent')));
        for (const f of failures) {
          const ref = `run:${runId}:test:${f.caseId}`;
          const open = existing.find((e) => e.externalRef === ref && e.status !== 'done');
          if (open) {
            keys.push(open.key);
            continue;
          }
          const child = await createTicket(
            tx,
            {
              projectId: r.projectId,
              title: `Test ${f.caseId} failed: ${f.title}`.slice(0, 160),
              description: `Found by QA while building ${parent!.key}.\n\n${f.details}`,
              type: 'bug',
              priority: parent!.priority,
              labels: ['found-by-qa'],
              acceptanceCriteria: [{ id: 'AC1', text: `Test ${f.caseId} (${f.title}) passes.` }],
              source: 'agent',
              status: 'building',
              reporterId: null,
              assigneeId: parent!.assigneeId,
              parentId: r.ticketId,
              externalRef: ref,
            },
            { type: 'agent', agentKey: 'qa' },
          );
          await appendActivity(tx, {
            projectId: r.projectId,
            ticketId: r.ticketId,
            runId,
            actorType: 'agent',
            agentKey: 'qa',
            type: 'defect.logged',
            summary: `Logged defect ${child.key}: test ${f.caseId} failed`,
            data: { defectKey: child.key, caseId: f.caseId },
          });
          keys.push(child.key);
        }
      });
      return keys;
    },

    /** Close this run's open defect tickets once the tests pass. */
    async resolveDefects(runId: string): Promise<string[]> {
      const r = await runRow(db, runId);
      const open = await db
        .select({ id: tickets.id, key: tickets.key })
        .from(tickets)
        .where(and(eq(tickets.parentId, r.ticketId), eq(tickets.source, 'agent'), inArray(tickets.status, ['building', 'blocked']), sql`${tickets.externalRef} like ${`run:${runId}:%`}`));
      await db.transaction(async (tx) => {
        for (const d of open) {
          await setTicketStatus(tx, d.id, 'done', { type: 'agent', agentKey: 'qa' }, { reason: 're-test passed', runId });
          await appendActivity(tx, {
            projectId: r.projectId,
            ticketId: r.ticketId,
            runId,
            actorType: 'agent',
            agentKey: 'qa',
            type: 'defect.resolved',
            summary: `Defect ${d.key} fixed and re-tested`,
            data: { defectKey: d.key },
          });
        }
      });
      return open.map((d) => d.key);
    },

    async completeRun(runId: string, status: 'succeeded' | 'failed' | 'cancelled', message: string | null): Promise<void> {
      const r = await runRow(db, runId);
      if (['succeeded', 'failed', 'cancelled'].includes(r.status)) return; // idempotent
      const [t] = await db.select().from(tickets).where(eq(tickets.id, r.ticketId));
      await db.transaction(async (tx) => {
        await setRun(tx, r, { status, finishedAt: new Date(), error: message });
        await tx.update(gates).set({ status: 'cancelled' }).where(and(eq(gates.runId, runId), eq(gates.status, 'pending')));
        await tx.update(runSteps).set({ status: 'skipped', currentAction: null }).where(and(eq(runSteps.runId, runId), inArray(runSteps.status, ['pending', 'running'])));
        await tx.update(tickets).set({ activeRunId: null }).where(and(eq(tickets.id, r.ticketId), eq(tickets.activeRunId, runId)));
        const label = status === 'succeeded' ? 'Run completed' : status === 'cancelled' ? 'Run cancelled' : `Run failed: ${message ?? 'unknown error'}`;
        await appendActivity(tx, {
          projectId: r.projectId,
          ticketId: r.ticketId,
          runId,
          actorType: 'system',
          type: status === 'succeeded' ? 'run.succeeded' : status === 'cancelled' ? 'run.cancelled' : 'run.failed',
          summary: label,
          data: { message },
        });
        const next = statusForRunOutcome(status);
        if (next) await setTicketStatus(tx, r.ticketId, next, { type: 'system' }, { reason: label.toLowerCase(), runId });
        await notifyUsers(tx, [...ticketWatchers(t!), ...(r.startedById ? [r.startedById] : [])], {
          type: `run.${status}`,
          title: `${t!.key}: ${label}`,
          body: t!.title,
          link: `/tickets/${t!.key}`,
        });
      });
      if (status === 'succeeded' || status === 'cancelled') await removeRunWorkspace(deps.config, runId).catch(() => undefined);
    },

    async projectKeyOf(projectId: string): Promise<string> {
      const [p] = await db.select({ key: projects.key }).from(projects).where(eq(projects.id, projectId));
      return p?.key ?? '';
    },
  };
}

async function buildGateSummary(db: DbOrTx, runId: string, kind: GateKind, escalation: { reason: string; needed: string } | null): Promise<GateSummary> {
  if (kind === 'escalation') {
    return {
      headline: 'The run needs a person',
      reason: escalation?.reason ?? 'Unknown',
      points: [
        { label: 'What happened', value: escalation?.reason ?? 'Unknown', tone: 'bad' },
        { label: 'What is needed', value: escalation?.needed ?? 'Review the run and decide', tone: 'warn' },
      ],
      artifactIds: [],
    };
  }
  if (kind === 'plan') {
    const impact = await latestArtifact(db, runId, 'impact_map');
    const plan = await latestArtifact(db, runId, 'change_plan');
    const tests = await latestArtifact(db, runId, 'test_plan');
    const ic = impact?.content as { components?: { changeType: string }[] } | undefined;
    const pc = plan?.content as { changes?: unknown[]; complexity?: string } | undefined;
    const tc = tests?.content as { cases?: unknown[] } | undefined;
    return {
      headline: 'Approve the change plan',
      points: [
        { label: 'Components to change', value: String(ic?.components?.filter((c) => c.changeType === 'modify' || c.changeType === 'add').length ?? 0) },
        { label: 'Components to regression-test', value: String(ic?.components?.filter((c) => c.changeType === 'verify').length ?? 0) },
        { label: 'Planned changes', value: String(pc?.changes?.length ?? 0) },
        { label: 'Tests prepared', value: String(tc?.cases?.length ?? 0) },
        { label: 'Complexity', value: pc?.complexity ?? 'not stated' },
        { label: 'Runs in', value: 'Sandbox only', tone: 'ok' },
      ],
      artifactIds: [impact?.id, plan?.id, tests?.id].filter((x): x is string => !!x),
    };
  }
  const results = await latestArtifact(db, runId, 'test_results');
  const review = await latestArtifact(db, runId, 'review_report');
  const security = await latestArtifact(db, runId, 'security_report');
  const code = await latestArtifact(db, runId, 'code_change');
  const dbc = await latestArtifact(db, runId, 'db_change');
  const rc = results?.content as { passed?: boolean; results?: { status: string }[] } | undefined;
  const passed = rc?.results?.filter((x) => x.status === 'passed').length ?? 0;
  const total = rc?.results?.filter((x) => x.status !== 'skipped').length ?? 0;
  const [run] = await db.select({ qa: runs.qaAttempts, branch: runs.branch }).from(runs).where(eq(runs.id, runId));
  return {
    headline: 'Approve the release',
    points: [
      { label: 'Tests', value: `${passed} of ${total} passed`, tone: rc?.passed ? 'ok' : 'bad' },
      { label: 'Test cycles', value: String(run?.qa ?? 0) },
      { label: 'Code review', value: (review?.content as { approved?: boolean })?.approved ? 'Approved' : 'Not approved', tone: (review?.content as { approved?: boolean })?.approved ? 'ok' : 'bad' },
      { label: 'Security', value: (security?.content as { approved?: boolean })?.approved ? 'Passed' : 'Not passed', tone: (security?.content as { approved?: boolean })?.approved ? 'ok' : 'bad' },
      { label: 'Files changed', value: String(((code?.content as { files?: unknown[] })?.files?.length ?? 0) + ((dbc?.content as { scripts?: unknown[] })?.scripts?.length ?? 0)) },
      { label: 'Branch', value: run?.branch ?? 'none' },
    ],
    artifactIds: [results?.id, review?.id, security?.id, code?.id, dbc?.id].filter((x): x is string => !!x),
  };
}

