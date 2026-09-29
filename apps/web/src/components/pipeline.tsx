'use client';

import { Check, Lock, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  AGENTS,
  effectiveStages,
  TASKS,
  type AgentTask,
  type GateDto,
  type RunDetailDto,
  type RunStepDto,
  type StageDefinition,
} from '@lsa/contracts';
import { ago, dateTime, money } from '@/lib/format';
import { AgentIcon, type AgentTone } from './agent-icon';
import { ArtifactLink } from './artifact-view';
import { cx, IconButton, Pill, Sheet } from './ui';

type NodeState = 'done' | 'run' | 'wait' | 'bad' | 'idle';

interface NodeInfo {
  task: AgentTask;
  state: NodeState;
  latest: RunStepDto | null;
  attempts: RunStepDto[];
}

const QA_TASKS: AgentTask[] = ['acceptance_tests', 'test_plan', 'reproduce_defect', 'run_tests'];

function nodeState(steps: RunStepDto[], runFinished: boolean): NodeState {
  const latest = steps.at(-1);
  if (!latest) return 'idle';
  if (latest.status === 'running') return 'run';
  if (latest.status === 'succeeded') return 'done';
  if (latest.status === 'failed') return runFinished ? 'bad' : 'bad';
  return 'idle';
}

/**
 * The run as a left-to-right pipeline: stage columns with agent cards,
 * approval gates between stages, and the QA lane underneath.
 */
export function Pipeline({ run, onGate }: { run: RunDetailDto; onGate: (g: GateDto) => void }) {
  const [openTask, setOpenTask] = useState<AgentTask | null>(null);
  const finished = ['succeeded', 'failed', 'cancelled'].includes(run.status);
  const stages = useMemo(
    () => effectiveStages(run.workflowType, { plan: true, release: true }),
    [run.workflowType],
  );
  const byTask = useMemo(() => {
    const m = new Map<AgentTask, RunStepDto[]>();
    for (const s of run.steps) m.set(s.task, [...(m.get(s.task) ?? []), s]);
    return m;
  }, [run.steps]);
  const info = (t: AgentTask): NodeInfo => {
    const attempts = byTask.get(t) ?? [];
    return { task: t, state: nodeState(attempts, finished), latest: attempts.at(-1) ?? null, attempts };
  };
  const gatesByKind = (kind: 'plan' | 'release') => run.gates.filter((g) => g.kind === kind);
  const escalation = run.gates.find((g) => g.kind === 'escalation' && g.status === 'pending');

  const stageTasks = (s: StageDefinition): AgentTask[] => {
    const all = s.groups.flat();
    if (s.qaLoop) all.push('fix_failures');
    return all.filter((t) => !QA_TASKS.includes(t));
  };
  const stageDone = (s: StageDefinition) => {
    const ts = [...s.groups.flat(), ...(s.qaLoop ? ['run_tests' as AgentTask] : [])];
    return ts.length > 0 && ts.every((t) => info(t).state === 'done');
  };

  return (
    <div className="dot-grid overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-0 px-4 pt-4 pb-3">
        {stages.map((s, i) => {
          const current = run.currentStage === s.key && !finished;
          const gateKind = s.gateBefore;
          const gs = gateKind ? gatesByKind(gateKind) : [];
          const g = gs.at(-1);
          return (
            <div key={s.key} className="flex items-stretch">
              {i > 0 && (
                <Connector
                  active={current || (!!g && g.status === 'pending')}
                  done={stageDone(stages[i - 1]!)}
                />
              )}
              {gateKind && (
                <>
                  <GateNode kind={gateKind} gate={g ?? null} onClick={() => g && onGate(g)} />
                  <Connector active={current} done={g?.status === 'approved'} />
                </>
              )}
              <div
                className={cx(
                  'flex w-[200px] flex-col gap-2.5 rounded-2xl border p-3 transition-colors',
                  current
                    ? 'border-run/25 bg-run/[0.035]'
                    : stageDone(s)
                      ? 'border-transparent'
                      : 'border-transparent',
                )}
              >
                <div className="flex items-center gap-2 px-1 font-mono text-[10.5px] tracking-[0.12em] uppercase">
                  <span className="text-faint">{i + 1}</span>
                  <b
                    className={cx(
                      'font-medium',
                      stageDone(s) ? 'text-ok' : current ? 'text-run' : 'text-muted',
                    )}
                  >
                    {s.name}
                  </b>
                </div>
                {stageTasks(s).map((t) => (
                  <AgentNode key={t} n={info(t)} onClick={() => setOpenTask(t)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <QaLane stages={stages} info={info} onOpen={setOpenTask} />
      {escalation && (
        <button
          onClick={() => onGate(escalation)}
          className="mx-4 mb-4 flex w-[calc(100%-32px)] items-center gap-3 rounded-xl border border-bad/40 bg-bad/8 px-4 py-3 text-left text-[13.5px] transition hover:bg-bad/12"
        >
          <TriangleAlert className="size-4 shrink-0 text-bad" />
          <span className="min-w-0 flex-1 truncate">{escalation.summary.reason}</span>
          <span className="shrink-0 text-bad">Review →</span>
        </button>
      )}
      <StepSheet node={openTask ? info(openTask) : null} onClose={() => setOpenTask(null)} />
    </div>
  );
}

function Connector({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div className="flex w-8 items-center">
      <svg width="32" height="8" className="overflow-visible" aria-hidden="true">
        <line
          x1="0"
          y1="4"
          x2="32"
          y2="4"
          strokeWidth="1.6"
          className={cx(active ? 'animate-dash stroke-run' : done ? 'stroke-ok/60' : 'stroke-white/15')}
          strokeDasharray={active ? '6 8' : done ? undefined : '3 6'}
        />
      </svg>
    </div>
  );
}

function GateNode({
  kind,
  gate,
  onClick,
}: {
  kind: 'plan' | 'release';
  gate: GateDto | null;
  onClick: () => void;
}) {
  const status = gate?.status ?? 'locked';
  const pending = status === 'pending';
  const passed = status === 'approved';
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-1">
      <button
        onClick={onClick}
        disabled={!gate}
        aria-label={`${kind === 'plan' ? 'Plan' : 'Release'} approval gate`}
        className="relative grid size-[62px] place-items-center disabled:cursor-default"
      >
        <span
          className={cx(
            'absolute inset-[9px] rotate-45 rounded-[10px] border transition',
            pending
              ? 'animate-pulse-wait border-wait bg-wait/14'
              : passed
                ? 'border-ok/60 bg-ok/12'
                : status === 'changes_requested'
                  ? 'border-wait/50 bg-wait/6'
                  : status === 'rejected'
                    ? 'border-bad/60 bg-bad/10'
                    : 'border-line-2 bg-panel-2',
          )}
        />
        <span
          className={cx(
            'relative',
            pending ? 'text-wait' : passed ? 'text-ok' : status === 'rejected' ? 'text-bad' : 'text-faint',
          )}
        >
          {passed ? (
            <Check className="size-4" />
          ) : status === 'rejected' ? (
            <X className="size-4" />
          ) : (
            <Lock className="size-4" />
          )}
        </span>
        {pending && (
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 animate-float rounded-full bg-wait px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-[#241703] shadow-[0_10px_30px_-8px_rgba(245,188,98,0.55)]">
            {kind === 'plan' ? 'Approve plan' : 'Approve release'}
          </span>
        )}
      </button>
      <span
        className={cx(
          'text-center font-mono text-[10px] leading-tight tracking-[0.08em] uppercase',
          pending ? 'text-wait' : passed ? 'text-ok' : 'text-faint',
        )}
      >
        {kind === 'plan' ? 'Gate 1' : 'Gate 2'}
        <br />
        {passed
          ? 'Approved'
          : pending
            ? 'Your call'
            : status === 'changes_requested'
              ? 'Sent back'
              : status === 'rejected'
                ? 'Rejected'
                : 'You'}
      </span>
    </div>
  );
}

function AgentNode({ n, onClick }: { n: NodeInfo; onClick: () => void }) {
  const def = TASKS[n.task];
  const a = AGENTS[def.agent];
  const tone: AgentTone =
    n.state === 'done' ? 'done' : n.state === 'run' ? 'run' : n.state === 'bad' ? 'bad' : 'idle';
  const sub =
    n.state === 'run'
      ? (n.latest?.currentAction ?? 'Working')
      : n.state === 'done'
        ? 'Done'
        : n.state === 'bad'
          ? (n.latest?.error ?? 'Needs attention')
          : n.task === 'fix_failures'
            ? 'Only if tests fail'
            : 'Queued';
  return (
    <button
      onClick={onClick}
      className={cx(
        'group relative flex h-[62px] w-full items-center gap-2.5 overflow-hidden rounded-[14px] border bg-panel-2 px-2.5 text-left transition hover:-translate-y-0.5',
        n.state === 'run' &&
          'border-run/55 shadow-[0_0_0_4px_rgba(98,201,255,0.07),0_14px_34px_-10px_rgba(98,201,255,0.35)]',
        n.state === 'done' && 'border-line-2',
        n.state === 'bad' && 'border-bad/55',
        n.state === 'idle' && 'border-dashed border-line-2 opacity-60',
      )}
    >
      <AgentIcon agent={def.agent} tone={tone} size={32} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[12.5px] font-semibold">{a.shortName}</span>
        <span
          className={cx(
            'truncate text-[11px]',
            n.state === 'run' ? 'text-run' : n.state === 'bad' ? 'text-bad' : 'text-faint',
          )}
        >
          {sub}
        </span>
      </span>
      {n.attempts.length > 1 && (
        <span className="absolute top-1.5 right-2 font-mono text-[9.5px] text-faint">
          ×{n.attempts.length}
        </span>
      )}
      {n.state === 'run' && (
        <span className="shine-run pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" />
      )}
    </button>
  );
}

function QaLane({
  stages,
  info,
  onOpen,
}: {
  stages: StageDefinition[];
  info: (t: AgentTask) => NodeInfo;
  onOpen: (t: AgentTask) => void;
}) {
  const points = stages.flatMap((s) =>
    [...s.groups.flat(), ...(s.qaLoop ? ['run_tests' as AgentTask] : [])]
      .filter((t) => QA_TASKS.includes(t))
      .map((t) => ({ stage: s.name, t })),
  );
  if (points.length === 0) return null;
  const active = points.find((p) => info(p.t).state === 'run');
  return (
    <div className="mx-4 mb-4 rounded-2xl border border-dashed border-accent/35 bg-accent/[0.035] px-4 py-3">
      <div className="flex items-center gap-3">
        <AgentIcon agent="qa" tone="accent" size={30} />
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold">QA / Test Engineer</div>
          <div className="truncate text-[11.5px] text-muted">
            {active ? (info(active.t).latest?.currentAction ?? 'Testing') : 'Works across every stage'}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {points.map((p) => {
          const n = info(p.t);
          return (
            <button
              key={p.t}
              onClick={() => onOpen(p.t)}
              className={cx(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition hover:border-white/25',
                n.state === 'done'
                  ? 'border-accent/40 text-text'
                  : n.state === 'run'
                    ? 'border-run/50 text-run'
                    : n.state === 'bad'
                      ? 'border-bad/50 text-bad'
                      : 'border-line-2 text-faint',
              )}
            >
              <span
                className={cx(
                  'size-2 rounded-full',
                  n.state === 'done'
                    ? 'bg-accent'
                    : n.state === 'run'
                      ? 'animate-breathe bg-run'
                      : n.state === 'bad'
                        ? 'bg-bad'
                        : 'border border-faint',
                )}
              />
              {TASKS[p.t].title.replace(/^./, (c) => c.toUpperCase())}
              {n.attempts.length > 1 && (
                <span className="font-mono text-[10px] text-faint">×{n.attempts.length}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepSheet({ node, onClose }: { node: NodeInfo | null; onClose: () => void }) {
  const def = node ? TASKS[node.task] : null;
  const agent = def ? AGENTS[def.agent] : null;
  return (
    <Sheet open={!!node} onClose={onClose}>
      {node && def && agent && (
        <>
          <div className="flex items-center gap-3.5 border-b border-line py-5 pr-14 pl-5">
            <AgentIcon
              agent={def.agent}
              size={44}
              tone={
                node.state === 'done'
                  ? 'done'
                  : node.state === 'run'
                    ? 'run'
                    : node.state === 'bad'
                      ? 'bad'
                      : 'idle'
              }
            />
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold">{agent.name}</div>
              <div className="mt-1">
                <Pill
                  tone={
                    node.state === 'done'
                      ? 'ok'
                      : node.state === 'run'
                        ? 'run'
                        : node.state === 'bad'
                          ? 'bad'
                          : 'idle'
                  }
                  live={node.state === 'run'}
                >
                  {node.state === 'done'
                    ? 'Done'
                    : node.state === 'run'
                      ? 'Working'
                      : node.state === 'bad'
                        ? 'Stopped'
                        : 'Not started'}
                </Pill>
              </div>
            </div>
            <IconButton label="Close" onClick={onClose} className="size-8">
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5">
            <div>
              <div className="eyebrow mb-1.5">Task</div>
              <div className="text-[14px]">{def.title}</div>
            </div>
            <p className="text-[13.5px] leading-relaxed text-muted">{agent.description}</p>
            <div className="flex flex-col gap-3">
              <div className="eyebrow">Attempts</div>
              {node.attempts.length === 0 && (
                <div className="text-[13px] text-faint">This step has not run yet.</div>
              )}
              {[...node.attempts].reverse().map((s) => (
                <div key={s.id} className="rounded-xl border border-line bg-panel-2 p-3.5">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="font-mono text-faint">#{s.attempt}</span>
                    <Pill
                      tone={
                        s.status === 'succeeded'
                          ? 'ok'
                          : s.status === 'running'
                            ? 'run'
                            : s.status === 'failed'
                              ? 'bad'
                              : 'idle'
                      }
                      live={s.status === 'running'}
                    >
                      {s.status}
                    </Pill>
                    <span className="ml-auto font-mono text-[11px] text-faint">{money(s.costUsd)}</span>
                  </div>
                  {s.currentAction && <div className="mt-2 text-[13px] text-run">{s.currentAction}</div>}
                  {s.error && <div className="mt-2 text-[13px] text-bad">{s.error}</div>}
                  <div className="mt-2 text-[11.5px] text-faint">
                    {s.startedAt ? `Started ${dateTime(s.startedAt)}` : ''}
                    {s.finishedAt ? ` · finished ${ago(s.finishedAt)}` : ''}
                  </div>
                  {s.artifactId && (
                    <div className="mt-2.5">
                      <ArtifactLink id={s.artifactId} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <div className="eyebrow">Skills this agent can load</div>
              <div className="flex flex-wrap gap-1.5">
                {agent.skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-line-2 px-2.5 py-1 text-[11.5px] text-muted"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}
