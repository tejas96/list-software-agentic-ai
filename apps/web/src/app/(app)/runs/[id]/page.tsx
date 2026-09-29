'use client';

import { GitBranch, Pause, Play, RotateCcw, Square } from 'lucide-react';
import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import { AGENTS, ARTIFACT_LABELS, effectiveStages, WORKFLOWS, type GateDto } from '@lsa/contracts';
import { ActivityFeed } from '@/components/activity-feed';
import { AgentIcon } from '@/components/agent-icon';
import { ArtifactModal } from '@/components/artifact-view';
import { GateCard, GateDialog } from '@/components/gate';
import { Pipeline } from '@/components/pipeline';
import { Button, Card, CardHeader, cx, ErrorBox, Loading, Pill, errorText, useToast } from '@/components/ui';
import { ago, dateTime, money, RUN_STATUS_LABELS, runTone } from '@/lib/format';
import { get, keys, post, useAction, useRun } from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';
import type { ActivityDto } from '@lsa/contracts';
import { useRoom } from '@/lib/realtime';

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const run = useRun(id);
  const [gate, setGate] = useState<GateDto | null>(null);
  const [artifact, setArtifact] = useState<string | null>(null);
  const toast = useToast();
  useRoom(`run:${id}`);
  const feed = useQuery({
    queryKey: ['timeline', 'run', id],
    queryFn: () => get<ActivityDto[]>(`/tickets/${run.data!.ticketKey}/timeline`),
    enabled: !!run.data,
    select: (items) => items.filter((a) => a.runId === id).reverse(),
  });
  const control = useAction(
    (action: string) => post(`/runs/${id}/control`, { action }),
    [keys.run(id), ['ticket']],
  );

  const stages = useMemo(
    () => (run.data ? effectiveStages(run.data.workflowType, { plan: true, release: true }) : []),
    [run.data],
  );

  if (run.isLoading) return <Loading />;
  if (run.error || !run.data)
    return (
      <div className="p-8">
        <ErrorBox error={run.error} />
      </div>
    );
  const r = run.data;
  const finished = ['succeeded', 'failed', 'cancelled'].includes(r.status);
  const pending = r.gates.find((g) => g.status === 'pending');
  const doneStages = stages.filter((s, i) => {
    const cur = stages.findIndex((x) => x.key === r.currentStage);
    return r.status === 'succeeded' || (cur > -1 && i < cur);
  }).length;

  const act = async (action: 'pause' | 'resume' | 'cancel' | 'retry') => {
    try {
      await control.mutateAsync(action);
      toast(
        {
          pause: 'Pausing after the current step',
          resume: 'Run resumed',
          cancel: 'Cancelling the run',
          retry: 'Retrying the blocked step',
        }[action],
      );
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="eyebrow">
            Run · {WORKFLOWS[r.workflowType].name} ·{' '}
            <Link href={`/tickets/${r.ticketKey}`} className="text-accent hover:underline">
              {r.ticketKey}
            </Link>
          </div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight [text-wrap:balance]">
            {r.ticketTitle}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={runTone(r.status)} live={r.status === 'running' || r.status === 'awaiting_approval'}>
              {RUN_STATUS_LABELS[r.status]}
              {r.currentStage && !finished
                ? ` · ${stages.find((s) => s.key === r.currentStage)?.name ?? r.currentStage}`
                : ''}
            </Pill>
            <span className="rounded-full border border-line-2 px-2.5 py-0.5 text-[12px] text-muted">
              Started {ago(r.startedAt)}
              {r.startedBy ? ` by ${r.startedBy.name}` : ''}
            </span>
            {r.branch && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-0.5 font-mono text-[11.5px] text-muted">
                <GitBranch className="size-3" /> {r.branch}
              </span>
            )}
            <span
              className={cx(
                'rounded-full border px-2.5 py-0.5 font-mono text-[11.5px]',
                r.costUsd > r.budgetUsd * 0.8 ? 'border-wait/40 text-wait' : 'border-line-2 text-muted',
              )}
            >
              {money(r.costUsd)} of {money(r.budgetUsd)}
            </span>
          </div>
        </div>
        {!finished && (
          <div className="flex flex-wrap gap-2">
            {r.status === 'blocked' && (
              <Button variant="warn" onClick={() => act('retry')}>
                <RotateCcw className="size-4" /> Retry step
              </Button>
            )}
            {r.status === 'paused' ? (
              <Button variant="ghost" onClick={() => act('resume')}>
                <Play className="size-4" /> Resume
              </Button>
            ) : (
              r.status !== 'blocked' && (
                <Button variant="ghost" onClick={() => act('pause')}>
                  <Pause className="size-4" /> Pause
                </Button>
              )
            )}
            <Button variant="ghost" onClick={() => act('cancel')}>
              <Square className="size-4" /> Cancel run
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stages.map((s, i) => {
          const cur = s.key === r.currentStage && !finished;
          const done = i < doneStages || r.status === 'succeeded';
          const hold = cur && r.status === 'awaiting_approval';
          return (
            <div key={s.key} className="flex flex-col gap-2">
              <div className="relative h-1 overflow-hidden rounded-full bg-white/7">
                <span
                  className={cx(
                    'absolute inset-0 rounded-full transition-all duration-700',
                    done ? 'bg-ok' : hold ? 'shine-wait' : cur ? 'shine-run' : 'w-0',
                  )}
                />
              </div>
              <div
                className={cx(
                  'flex items-baseline gap-1.5 text-[12.5px]',
                  done || cur ? 'text-text' : 'text-faint',
                )}
              >
                <span
                  className={cx(
                    'font-mono text-[10.5px]',
                    done ? 'text-ok' : hold ? 'text-wait' : cur ? 'text-run' : '',
                  )}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                {s.name}
              </div>
            </div>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[14px] font-semibold">Pipeline</h2>
          <span className="text-[12.5px] text-muted">Select any agent to see its steps and results</span>
          <div className="ml-auto flex flex-wrap gap-3.5 text-[12px] text-muted">
            <Legend c="bg-ok" l="Done" />
            <Legend c="bg-run" l="Working" />
            <Legend c="bg-wait" l="Needs you" />
            <Legend c="bg-bad" l="Stopped" />
            <Legend c="border border-dashed border-faint" l="Queued" />
          </div>
        </div>
        <Pipeline run={r} onGate={setGate} />
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="Live activity"
            right={
              <Pill
                tone={finished ? 'ok' : r.status === 'running' ? 'run' : 'idle'}
                live={r.status === 'running'}
              >
                {finished ? 'Finished' : r.status === 'running' ? 'Live' : RUN_STATUS_LABELS[r.status]}
              </Pill>
            }
          />
          <div className="max-h-[520px] overflow-y-auto p-2">
            <ActivityFeed items={feed.data ?? []} empty="The run is starting." />
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          {pending ? (
            <GateCard gate={pending} onOpen={() => setGate(pending)} />
          ) : (
            <Card className="p-5">
              <Pill tone={finished ? runTone(r.status) : 'idle'}>
                {finished ? RUN_STATUS_LABELS[r.status] : 'Nothing needs you'}
              </Pill>
              <div className="mt-3 text-[16px] font-semibold">
                {finished
                  ? r.status === 'succeeded'
                    ? 'Run complete'
                    : r.status === 'cancelled'
                      ? 'Run cancelled'
                      : 'Run failed'
                  : 'The team is working'}
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                {finished
                  ? (r.error ?? 'Every step, test and approval is in the evidence pack.')
                  : 'You will be asked to decide at the gates, or if an agent needs a person.'}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
                <Stat label="Test cycles" value={r.qaAttempts} />
                <Stat label="Plan revisions" value={r.planRevisions} />
                <Stat label="Tokens in" value={r.tokens.input.toLocaleString()} />
                <Stat label="Tokens out" value={r.tokens.output.toLocaleString()} />
              </div>
              {finished && (
                <Link href={`/evidence/${r.ticketKey}`} className="mt-4 block">
                  <Button variant="primary" className="w-full">
                    Open the evidence pack
                  </Button>
                </Link>
              )}
            </Card>
          )}
          <Card>
            <CardHeader title="Artifacts" />
            <div className="p-2">
              {r.artifacts.length === 0 && (
                <p className="px-3 py-5 text-center text-[13px] text-faint">
                  Results appear here as agents finish steps.
                </p>
              )}
              {[...r.artifacts].reverse().map((a) => (
                <button
                  key={a.id}
                  onClick={() => setArtifact(a.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.03]"
                >
                  <AgentIcon agent={a.agentKey} size={28} tone="accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">{a.title || ARTIFACT_LABELS[a.kind]}</span>
                    <span className="block text-[11.5px] text-faint">
                      {a.agentKey ? AGENTS[a.agentKey].name : 'Platform'} · {dateTime(a.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <GateDialog gate={gate} open={!!gate} onClose={() => setGate(null)} />
      <ArtifactModal id={artifact} onClose={() => setArtifact(null)} />
    </div>
  );
}

function Legend({ c, l }: { c: string; l: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cx('size-2 rounded-full', c)} />
      {l}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-3 py-2">
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="text-faint">{label}</div>
    </div>
  );
}
