/**
 * Runs the real SDLC workflow on a real Temporal server with scripted
 * activities, and checks the whole path: plan sent back and revised, plan
 * approved, a failing test logged as a defect, fixed and re-tested, a review
 * finding sent back through build and test, release approved and published.
 * Skipped when no Temporal server is reachable (TEMPORAL_ADDRESS).
 */
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIGNALS, WORKFLOW_NAMES, type AgentTask, type RunWorkflowState } from '@lsa/contracts';
import type { AgentStepResult, AgentStepInput } from './activities/agent-step.js';

const ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

async function reachable(): Promise<boolean> {
  try {
    const c = await Connection.connect({ address: ADDRESS, connectTimeout: '2s' });
    await c.close();
    return true;
  } catch {
    return false;
  }
}

const ok = (over: Partial<AgentStepResult> = {}): AgentStepResult => ({
  status: 'completed',
  artifactId: `art-${Math.random().toString(36).slice(2, 8)}`,
  artifactKind: null,
  passed: null,
  approved: null,
  failures: [],
  needed: null,
  reason: null,
  commit: null,
  ...over,
});

describe.skipIf(!(await reachable()))('sdlcRunWorkflow (Temporal)', () => {
  let nativeConn: NativeConnection;
  let client: Client;
  let worker: Worker;
  let running: Promise<void>;
  const queue = `test-${Date.now()}`;
  const calls: string[] = [];
  const gates: string[] = [];
  let testRuns = 0;
  let reviews = 0;
  let completed: { status: string; message: string | null } | null = null;

  beforeAll(async () => {
    nativeConn = await NativeConnection.connect({ address: ADDRESS });
    client = new Client({ connection: await Connection.connect({ address: ADDRESS }) });
    const shared = {
      loadRun: async () => ({ runId: 'r1', ticketId: 't1', ticketKey: 'BNK-1', projectId: 'p1', workflowType: 'full_change', gates: { plan: true, release: true }, qaMaxAttempts: 3, maxPlanRevisions: 3 }),
      claimHost: async () => queue,
      setRunStatus: async (_r: string, s: string) => void calls.push(`status:${s}`),
      enterStage: async (_r: string, stage: string) => void calls.push(`stage:${stage}`),
      openGate: async (_r: string, kind: string) => {
        const id = `gate-${kind}-${gates.length + 1}`;
        gates.push(id);
        calls.push(`gate:${kind}`);
        return id;
      },
      readGate: async () => ({ status: 'pending', note: null, decidedById: null }),
      resolveEscalation: async () => undefined,
      recordRevision: async () => 1,
      logDefects: async () => {
        calls.push('defects:logged');
        return ['BNK-2'];
      },
      resolveDefects: async () => {
        calls.push('defects:resolved');
        return ['BNK-2'];
      },
      completeRun: async (_r: string, status: string, message: string | null) => {
        completed = { status, message };
      },
      projectKeyOf: async () => 'BNK',
      triage: async () => undefined,
      replyToComment: async () => undefined,
      syncSource: async () => ({ objects: 0, edges: 0, chunks: 0, warnings: [] }),
    };
    const host = {
      runAgentStep: async (input: AgentStepInput): Promise<AgentStepResult> => {
        calls.push(`task:${input.task as AgentTask}${input.feedback.length ? '+feedback' : ''}`);
        if (input.task === 'run_tests') {
          testRuns++;
          return testRuns === 1 ? ok({ passed: false, failures: ['T3 report validation failed'] }) : ok({ passed: true });
        }
        if (input.task === 'code_review') {
          reviews++;
          return reviews === 1 ? ok({ approved: false, failures: ['[major] missing audit column'] }) : ok({ approved: true });
        }
        if (input.task === 'security_review') return ok({ approved: true });
        return ok();
      },
      publishBranch: async () => {
        calls.push('publish');
        return { pushed: true, branch: 'lsa/bnk-1', pullRequestUrl: null, note: 'ok' };
      },
    };
    worker = await Worker.create({
      connection: nativeConn,
      taskQueue: queue,
      workflowsPath: fileURLToPath(new URL('../dist/workflows/index.js', import.meta.url)),
      activities: { ...shared, ...host },
    });
    running = worker.run();
  }, 60_000);

  afterAll(async () => {
    worker?.shutdown();
    await running;
    await nativeConn?.close();
  });

  it('drives a change from requirement to release through both gates and the QA loop', async () => {
    const handle = await client.workflow.start(WORKFLOW_NAMES.run, { taskQueue: queue, workflowId: `wf-${queue}`, args: [{ runId: 'r1' }] });
    const waitForGate = async (n: number) => {
      for (let i = 0; i < 200; i++) {
        const s = await handle.query<RunWorkflowState>('runState');
        if (s.pendingGateId && gates.length >= n) return s.pendingGateId;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`gate ${n} never opened`);
    };

    // Plan gate: send back once, then approve the revision.
    let gate = await waitForGate(1);
    await handle.signal(SIGNALS.gateDecision, { gateId: gate, decision: 'changes_requested', note: 'Split the report change', userId: 'u1' });
    gate = await waitForGate(2);
    await handle.signal(SIGNALS.gateDecision, { gateId: gate, decision: 'approved', note: null, userId: 'u1' });
    // Release gate.
    gate = await waitForGate(3);
    await handle.signal(SIGNALS.gateDecision, { gateId: gate, decision: 'approved', note: null, userId: 'u2' });
    expect(await handle.result()).toBe('succeeded');
    expect(completed).toEqual({ status: 'succeeded', message: null });

    const seq = calls.filter((c) => !c.startsWith('status:'));
    // Plan revision reran the planning tasks with the approver's feedback.
    expect(seq).toContain('task:change_plan+feedback');
    // The failed test was logged as a defect, fixed, re-tested, and the defect resolved.
    const firstFail = seq.indexOf('defects:logged');
    expect(seq.slice(firstFail, firstFail + 3)).toEqual(['defects:logged', 'task:fix_failures+feedback', 'task:run_tests']);
    expect(seq).toContain('defects:resolved');
    // The review finding went back through fix and test before verify passed.
    expect(seq.filter((c) => c === 'task:code_review')).toHaveLength(2);
    // Release happened after the release gate: package, publish, notes.
    const rel = seq.indexOf('task:package_release');
    expect(seq.slice(rel, rel + 3)).toEqual(['task:package_release', 'publish', 'task:release_notes']);
    expect(seq.filter((c) => c.startsWith('gate:'))).toEqual(['gate:plan', 'gate:plan', 'gate:release']);
  }, 60_000);

  it('cancels cleanly while waiting at a gate', async () => {
    gates.length = 0;
    completed = null;
    const handle = await client.workflow.start(WORKFLOW_NAMES.run, { taskQueue: queue, workflowId: `wf-cancel-${queue}`, args: [{ runId: 'r1' }] });
    for (let i = 0; i < 200 && gates.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    await handle.signal(SIGNALS.control, { action: 'cancel', userId: 'u1', note: 'Not needed any more' });
    expect(await handle.result()).toBe('cancelled');
    expect(completed).toEqual({ status: 'cancelled', message: 'Not needed any more' });
  }, 60_000);
});
