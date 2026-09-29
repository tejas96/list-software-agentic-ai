/**
 * Temporal workflows. This file runs in Temporal's deterministic sandbox:
 * only import @temporalio/workflow, type-only activity imports and pure
 * modules (@lsa/contracts). All I/O happens in activities.
 */
import {
  ApplicationFailure,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import {
  effectiveStages,
  QUERIES,
  SIGNALS,
  TASKS,
  type AgentReplyWorkflowInput,
  type AgentTask,
  type GateDecisionSignal,
  type RunControlSignal,
  type RunWorkflowInput,
  type RunWorkflowState,
  type StageDefinition,
  type SyncSourceWorkflowInput,
  type TriageWorkflowInput,
} from '@lsa/contracts';
import type { AgentStepResult } from '../activities/agent-step.js';
import type { HostActivities, SharedActivities } from '../activities/index.js';

const quick = proxyActivities<SharedActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 10, initialInterval: '2s', backoffCoefficient: 2, maximumInterval: '1 minute' },
});

const slow = proxyActivities<SharedActivities>({
  startToCloseTimeout: '2 hours',
  heartbeatTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '30s',
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['NotFound'],
  },
});

export const gateDecision = defineSignal<[GateDecisionSignal]>(SIGNALS.gateDecision);
export const runControl = defineSignal<[RunControlSignal]>(SIGNALS.control);
export const runState = defineQuery<RunWorkflowState>(QUERIES.state);

class RunCancelled extends Error {
  constructor(public readonly note: string | null) {
    super('Run cancelled');
  }
}

/* ------------------------------------------------------------ SDLC run */

export async function sdlcRunWorkflow({ runId }: RunWorkflowInput): Promise<string> {
  const state: RunWorkflowState = {
    phase: 'running',
    stage: null,
    pendingGateId: null,
    qaAttempts: 0,
    planRevisions: 0,
  };
  const decisions = new Map<string, GateDecisionSignal>();
  let paused = false;
  let cancel: { note: string | null } | null = null;
  let retryRequested: { userId: string } | null = null;
  let currentScope: CancellationScope | null = null;

  setHandler(gateDecision, (s) => void decisions.set(s.gateId, s));
  setHandler(runState, () => state);
  setHandler(runControl, (c) => {
    if (c.action === 'pause') paused = true;
    else if (c.action === 'resume') paused = false;
    else if (c.action === 'retry') retryRequested = { userId: c.userId };
    else if (c.action === 'cancel') {
      cancel = { note: c.note };
      currentScope?.cancel();
    }
  });

  const run = await quick.loadRun(runId);
  const hostQueue = await quick.claimHost();
  const host = proxyActivities<HostActivities>({
    taskQueue: hostQueue,
    startToCloseTimeout: '3 hours',
    heartbeatTimeout: '5 minutes',
    retry: {
      maximumAttempts: 3,
      initialInterval: '30s',
      backoffCoefficient: 2,
      nonRetryableErrorTypes: ['NotFound', 'PushFailed'],
    },
  });

  const checkCancel = () => {
    if (cancel) throw new RunCancelled(cancel.note);
  };

  const waitWhilePaused = async () => {
    if (!paused) return;
    state.phase = 'paused';
    await quick.setRunStatus(runId, 'paused', null);
    await condition(() => !paused || cancel !== null);
    checkCancel();
    state.phase = 'running';
    await quick.setRunStatus(runId, 'running', null);
  };

  /** Wait for a decision on a gate. Re-reads the gate row every few minutes in case a signal was lost. */
  const waitForGate = async (
    gateId: string,
  ): Promise<{ decision: string; note: string | null; userId: string | null }> => {
    state.pendingGateId = gateId;
    for (;;) {
      const got = await condition(
        () => decisions.has(gateId) || cancel !== null || retryRequested !== null,
        '5 minutes',
      );
      checkCancel();
      if (retryRequested) {
        const r = retryRequested as { userId: string };
        retryRequested = null;
        state.pendingGateId = null;
        return { decision: 'retry', note: null, userId: r.userId };
      }
      if (got && decisions.has(gateId)) {
        const d = decisions.get(gateId)!;
        state.pendingGateId = null;
        return { decision: d.decision, note: d.note, userId: d.userId };
      }
      const g = await quick.readGate(gateId);
      if (g.status !== 'pending') {
        state.pendingGateId = null;
        return { decision: g.status, note: g.note, userId: g.decidedById };
      }
    }
  };

  /** Stop for a person. Returns when they choose to retry; throws if they stop the run. */
  const escalate = async (reason: string, needed: string): Promise<void> => {
    state.phase = 'blocked';
    const gateId = await quick.openGate(runId, 'escalation', { reason, needed });
    const d = await waitForGate(gateId);
    if (d.decision === 'retry') await quick.resolveEscalation(gateId, d.userId, 'approved');
    if (d.decision === 'rejected') throw new RunCancelled(d.note ?? 'Stopped at an escalation');
    state.phase = 'running';
    await quick.setRunStatus(runId, 'running', null);
  };

  /** Run one agent task; on a blocker or repeated failure, ask a person and retry when they say so. */
  const runTask = async (
    task: AgentTask,
    stage: StageDefinition['key'],
    feedback: string[],
  ): Promise<AgentStepResult> => {
    for (;;) {
      await waitWhilePaused();
      checkCancel();
      let result: AgentStepResult | null = null;
      let failure: string | null = null;
      try {
        currentScope = new CancellationScope();
        result = await currentScope.run(() => host.runAgentStep({ runId, task, stage, feedback }));
      } catch (err) {
        if (cancel || isCancellation(err))
          throw new RunCancelled(cancel ? (cancel as { note: string | null }).note : null);
        failure = errorMessage(err);
      } finally {
        currentScope = null;
      }
      if (result?.status === 'completed') return result;
      const reason = result?.reason ?? failure ?? 'The step failed';
      const needed =
        result?.needed ??
        'Check the error, fix the cause (configuration, access or inputs), then retry the run.';
      log.warn('Step needs a person', { runId, task, reason });
      await escalate(`${TASKS[task].title}: ${reason}`, needed);
    }
  };

  const runGroups = async (
    stage: StageDefinition,
    feedbackFor: (task: AgentTask) => string[],
  ): Promise<AgentStepResult[]> => {
    const all: AgentStepResult[] = [];
    for (const group of stage.groups) {
      const results = await Promise.all(group.map((t) => runTask(t, stage.key, feedbackFor(t))));
      all.push(...results);
    }
    return all;
  };

  /** Test, fix, re-test until green or the attempt limit, logging each product defect as a Bug ticket. */
  const qaLoop = async (initialFeedback: string[] = []): Promise<void> => {
    let attemptsThisLoop = 0;
    let fixFeedback = initialFeedback;
    if (fixFeedback.length) await runTask('fix_failures', 'build', fixFeedback);
    for (;;) {
      const res = await runTask('run_tests', 'build', []);
      state.qaAttempts = await quick.recordRevision(runId, 'qaAttempts');
      attemptsThisLoop++;
      if (res.passed) {
        await quick.resolveDefects(runId);
        return;
      }
      if (res.artifactId) await quick.logDefects(runId, res.artifactId);
      if (attemptsThisLoop >= run.qaMaxAttempts) {
        await escalate(
          `Tests still fail after ${attemptsThisLoop} test-and-fix cycles`,
          'Review the failing tests and the defect tickets. Retry to allow more cycles, or stop the run.',
        );
        attemptsThisLoop = 0;
      }
      fixFeedback = res.failures.length
        ? res.failures
        : ['Tests did not pass. Read the latest test results and fix the product defects.'];
      await runTask('fix_failures', 'build', fixFeedback);
    }
  };

  /** Code review and security; blocking findings go back to the developer, then tests and checks rerun. */
  const verifyLoop = async (stage: StageDefinition): Promise<void> => {
    for (let cycle = 1; ; cycle++) {
      const results = await runGroups(stage, () => []);
      const findings = results.filter((r) => r.approved === false).flatMap((r) => r.failures);
      if (findings.length === 0) return;
      if (cycle >= run.qaMaxAttempts) {
        await escalate(
          'Review or security findings remain after several fix cycles',
          'Read the review and security reports, then retry or stop the run.',
        );
        cycle = 0;
      }
      await qaLoop(findings.map((f) => `Review finding: ${f}`));
    }
  };

  let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded';
  let message: string | null = null;
  const planFeedback: string[] = [];
  try {
    const stages = effectiveStages(run.workflowType, run.gates);
    const planStage = stages.find((s) => s.key === 'plan');
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]!;
      if (stage.gateBefore) {
        for (;;) {
          state.phase = 'awaiting_gate';
          const gateId = await quick.openGate(runId, stage.gateBefore, null);
          const d = await waitForGate(gateId);
          state.phase = 'running';
          if (d.decision === 'approved') break;
          if (d.decision === 'rejected')
            throw new RunCancelled(`Rejected at the ${stage.gateBefore} gate${d.note ? `: ${d.note}` : ''}`);
          if (d.decision === 'retry') continue;
          // Changes requested.
          const note = d.note ?? 'Changes requested';
          if (stage.gateBefore === 'plan' && planStage) {
            state.planRevisions = await quick.recordRevision(runId, 'planRevisions');
            if (state.planRevisions > run.maxPlanRevisions) {
              await escalate(
                `The plan was sent back ${state.planRevisions} times`,
                'Agree the approach with the team, update the ticket, then retry.',
              );
            }
            planFeedback.push(`Approver feedback on revision ${state.planRevisions}: ${note}`);
            await quick.enterStage(runId, 'plan', 'Plan (revision)');
            await runGroups(planStage, (t) => (t === 'change_plan' || t === 'test_plan' ? planFeedback : []));
          } else {
            await quick.enterStage(runId, 'build', 'Build (release changes)');
            await qaLoop([`Release approver asked for changes: ${note}`]);
            const verify = stages.find((s) => s.key === 'verify');
            if (verify) {
              await quick.enterStage(runId, 'verify', 'Verify (after changes)');
              await verifyLoop(verify);
            }
          }
        }
      }
      await waitWhilePaused();
      checkCancel();
      state.stage = stage.key;
      await quick.enterStage(runId, stage.key, stage.name);
      if (stage.key === 'verify') {
        await verifyLoop(stage);
      } else if (stage.key === 'release' && run.workflowType !== 'analysis') {
        await runTask('package_release', 'release', []);
        await host.publishBranch(runId);
        await runTask('release_notes', 'release', []);
      } else {
        await runGroups(stage, (t) => (t === 'change_plan' || t === 'test_plan' ? planFeedback : []));
        if (stage.qaLoop) await qaLoop();
      }
    }
  } catch (err) {
    if (err instanceof RunCancelled || isCancellation(err)) {
      status = 'cancelled';
      message = err instanceof RunCancelled ? err.note : null;
    } else {
      status = 'failed';
      message = errorMessage(err);
    }
  }
  state.phase = 'finished';
  // Always record the outcome, even while being cancelled.
  await CancellationScope.nonCancellable(() => quick.completeRun(runId, status, message));
  return status;
}

/* ----------------------------------------------------- small workflows */

export async function triageTicketWorkflow({ ticketId }: TriageWorkflowInput): Promise<void> {
  await slow.triage(ticketId);
}

export async function agentReplyWorkflow({ commentId, agentKey }: AgentReplyWorkflowInput): Promise<void> {
  await slow.replyToComment(commentId, agentKey);
}

export async function syncSourceWorkflow({ sourceId }: SyncSourceWorkflowInput): Promise<void> {
  await slow.syncSource(sourceId);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApplicationFailure) return err.message;
  const cause = (err as { cause?: { message?: string } })?.cause;
  return cause?.message ?? (err as Error)?.message ?? String(err);
}
