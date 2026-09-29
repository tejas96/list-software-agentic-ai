'use client';

import { useQuery } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';
import Link from 'next/link';
import { WORKFLOWS, type RunSummaryDto } from '@lsa/contracts';
import { Card, CardHeader, EmptyState, ErrorBox, Loading, Pill } from '@/components/ui';
import { ago, money, RUN_STATUS_LABELS, runTone } from '@/lib/format';
import { get, useActiveRuns } from '@/lib/queries';

function RunList({ runs }: { runs: RunSummaryDto[] }) {
  return (
    <div className="p-2">
      {runs.map((r) => (
        <Link
          key={r.id}
          href={`/runs/${r.id}`}
          className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/[0.03]"
        >
          <span className="w-[80px] shrink-0 font-mono text-[12px] text-accent">{r.ticketKey}</span>
          <span className="text-[13.5px]">{WORKFLOWS[r.workflowType].name}</span>
          <span className="text-[12.5px] text-faint">
            {r.startedBy ? `${r.startedBy.name} · ` : ''}started {ago(r.startedAt)}
            {r.finishedAt ? ` · finished ${ago(r.finishedAt)}` : ''}
          </span>
          <span className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[11.5px] text-faint">{money(r.costUsd)}</span>
            <Pill tone={runTone(r.status)} live={r.status === 'running'}>
              {RUN_STATUS_LABELS[r.status]}
              {r.currentStage && !r.finishedAt ? ` · ${r.currentStage}` : ''}
            </Pill>
          </span>
          {r.error && <div className="w-full pl-[92px] text-[12.5px] text-bad">{r.error}</div>}
        </Link>
      ))}
    </div>
  );
}

export default function RunsPage() {
  const active = useActiveRuns();
  const recent = useQuery({
    queryKey: ['runs', 'recent'],
    queryFn: () => get<RunSummaryDto[]>('/runs?limit=50'),
  });
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-6 md:px-8">
      <div>
        <div className="eyebrow">Runs</div>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Agent runs</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] text-muted">
          Every run takes one ticket through its workflow. Open a run to follow the pipeline live, answer
          gates, or pause and cancel.
        </p>
      </div>
      <Card>
        <CardHeader title="In progress" />
        {active.isLoading ? (
          <Loading />
        ) : active.error ? (
          <ErrorBox error={active.error} />
        ) : (active.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Workflow className="size-5" />}
            title="No runs in progress"
            body="Start a run from a ticket, or log a requirement on Home with “Start the run right away”."
          />
        ) : (
          <RunList runs={active.data ?? []} />
        )}
      </Card>
      <Card>
        <CardHeader title="Recent" />
        {recent.isLoading ? (
          <Loading />
        ) : recent.error ? (
          <ErrorBox error={recent.error} />
        ) : (
          <RunList runs={(recent.data ?? []).filter((r) => r.finishedAt)} />
        )}
      </Card>
    </div>
  );
}
