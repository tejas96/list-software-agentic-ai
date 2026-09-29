'use client';

import { ArrowLeft, Download, FileCheck2, Printer } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import {
  ARTIFACT_LABELS,
  AGENTS,
  WORKFLOWS,
  type ArtifactKind,
  type RunStatus,
  type TicketStatus,
  type TicketType,
  type WorkflowType,
} from '@lsa/contracts';
import { ActivityFeed } from '@/components/activity-feed';
import { ArtifactModal } from '@/components/artifact-view';
import { StatusPill, TypeBadge } from '@/components/ticket-bits';
import { Button, Card, CardHeader, ErrorBox, Loading, Pill } from '@/components/ui';
import { dateTime, money, RUN_STATUS_LABELS, runTone } from '@/lib/format';
import { useEvidence } from '@/lib/queries';

const DECISION_TONE = {
  approved: 'ok',
  changes_requested: 'wait',
  rejected: 'bad',
  pending: 'wait',
  cancelled: 'idle',
} as const;
const DECISION_LABEL = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
  pending: 'Pending',
  cancelled: 'Cancelled',
} as const;

export default function EvidencePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const q = useEvidence(key);
  const [open, setOpen] = useState<string | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data)
    return (
      <div className="p-8">
        <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  const e = q.data;
  const cost = e.runs.reduce((n, r) => n + r.costUsd, 0);

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-4 py-6 md:px-8 print:max-w-none print:px-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link
          href={`/tickets/${e.ticket.key}`}
          className="flex items-center gap-1.5 text-[13px] text-muted hover:text-text"
        >
          <ArrowLeft className="size-4" /> Back to {e.ticket.key}
        </Link>
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" /> Print
          </Button>
          <a href={`/api/v1/evidence/${encodeURIComponent(e.ticket.key)}?download=true`} download>
            <Button variant="default" size="sm">
              <Download className="size-3.5" /> Download JSON
            </Button>
          </a>
        </span>
      </div>

      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="flex items-center gap-2 text-accent">
          <FileCheck2 className="size-4" />
          <span className="eyebrow text-accent">Evidence pack</span>
        </div>
        <h1 className="mt-3 text-[24px] font-semibold tracking-tight">
          <span className="mr-2 font-mono text-accent">{e.ticket.key}</span>
          {e.ticket.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TypeBadge type={e.ticket.type as TicketType} />
          <StatusPill status={e.ticket.status as TicketStatus} />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-[13px] sm:grid-cols-4">
          <Fact label="Logged">{dateTime(e.ticket.createdAt)}</Fact>
          <Fact label="Closed">{e.ticket.closedAt ? dateTime(e.ticket.closedAt) : 'Open'}</Fact>
          <Fact label="Runs">{e.runs.length}</Fact>
          <Fact label="Model cost">{money(cost)}</Fact>
        </dl>
        <p className="mt-5 text-[12px] text-faint">
          Generated {dateTime(e.generatedAt)}. Every entry below comes from the append-only, hash-chained
          audit trail and cannot be edited after the fact.
        </p>
      </Card>

      <Card>
        <CardHeader title={`Approvals · ${e.approvals.length}`} />
        <div className="flex flex-col divide-y divide-line">
          {e.approvals.length === 0 && (
            <p className="px-5 py-4 text-[13px] text-faint">No approval gates were opened for this ticket.</p>
          )}
          {e.approvals.map((g) => (
            <div key={g.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">
                  {g.kind === 'plan'
                    ? 'Plan approval'
                    : g.kind === 'release'
                      ? 'Release approval'
                      : 'Escalation'}
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted">{g.summary.headline}</div>
                {g.note && (
                  <div className="mt-2 rounded-lg bg-panel-2 px-3 py-2 text-[12.5px]">“{g.note}”</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <Pill tone={DECISION_TONE[g.status]}>{DECISION_LABEL[g.status]}</Pill>
                <span className="text-[11.5px] text-faint">
                  {g.decidedBy
                    ? `${g.decidedBy.name} · ${dateTime(g.decidedAt)}`
                    : `requested ${dateTime(g.requestedAt)}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Runs · ${e.runs.length}`} />
        <div className="flex flex-col divide-y divide-line">
          {e.runs.length === 0 && <p className="px-5 py-4 text-[13px] text-faint">No agent runs yet.</p>}
          {e.runs.map((r, i) => (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-white/[0.02]"
            >
              <span className="font-mono text-[12px] text-faint">#{i + 1}</span>
              <span className="text-[13.5px]">
                {WORKFLOWS[r.workflowType as WorkflowType]?.name ?? r.workflowType}
              </span>
              <span className="text-[12px] text-faint">
                {dateTime(r.startedAt)}
                {r.finishedAt ? ` → ${dateTime(r.finishedAt)}` : ''}
              </span>
              {r.branch && <span className="font-mono text-[11.5px] text-muted">{r.branch}</span>}
              <span className="ml-auto flex items-center gap-3">
                <span className="font-mono text-[11.5px] text-faint">{money(r.costUsd)}</span>
                <Pill tone={runTone(r.status as RunStatus)}>{RUN_STATUS_LABELS[r.status as RunStatus]}</Pill>
              </span>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Artifacts · ${e.artifacts.length}`} />
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
          {e.artifacts.length === 0 && (
            <p className="px-2 py-2 text-[13px] text-faint">Agents have not produced any documents yet.</p>
          )}
          {e.artifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpen(a.id)}
              className="flex flex-col gap-1 rounded-xl border border-line bg-panel-2 px-4 py-3 text-left transition hover:border-accent/40"
            >
              <span className="flex items-center gap-2">
                <span className="text-[13.5px] font-medium">
                  {ARTIFACT_LABELS[a.kind as ArtifactKind] ?? a.kind}
                </span>
                {a.version > 1 && <span className="font-mono text-[10.5px] text-faint">v{a.version}</span>}
              </span>
              <span className="truncate text-[12.5px] text-muted">{a.title}</span>
              <span className="text-[11.5px] text-faint">
                {a.agentKey ? AGENTS[a.agentKey].name : 'System'} · {dateTime(a.createdAt)}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Audit trail · ${e.trail.length} entries`} />
        <div className="p-3">
          <ActivityFeed items={e.trail} />
        </div>
      </Card>
      <ArtifactModal id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-text">{children}</dd>
    </div>
  );
}
