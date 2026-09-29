'use client';

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { GateDto } from '@lsa/contracts';
import { GateDialog } from '@/components/gate';
import { Button, Card, cx, EmptyState, ErrorBox, Loading, Pill } from '@/components/ui';
import { ago } from '@/lib/format';
import { useApprovals } from '@/lib/queries';

const KIND_LABEL = { plan: 'Plan approval', release: 'Release approval', escalation: 'Escalation' } as const;

export default function ApprovalsPage() {
  const q = useApprovals();
  const [open, setOpen] = useState<GateDto | null>(null);
  const items = q.data ?? [];
  const mine = items.filter((g) => g.canDecide);
  const others = items.filter((g) => !g.canDecide);

  const list = (gs: GateDto[]) => (
    <div className="flex flex-col gap-3">
      {gs.map((g) => (
        <Card
          key={g.id}
          className={cx(
            'flex flex-wrap items-center gap-4 p-4',
            g.kind === 'escalation' ? 'border-bad/35' : 'border-wait/30',
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={g.kind === 'escalation' ? 'bad' : 'wait'} live>
                {KIND_LABEL[g.kind]}
              </Pill>
              <span className="font-mono text-[11.5px] text-faint">
                {g.projectKey} · {g.ticketKey} · {ago(g.requestedAt)}
              </span>
            </div>
            <div className="truncate text-[15px] font-semibold">{g.ticketTitle}</div>
            <div className="truncate text-[13px] text-muted">
              {g.kind === 'escalation'
                ? g.summary.reason
                : g.summary.points
                    .slice(0, 4)
                    .map((p) => `${p.label}: ${p.value}`)
                    .join(' · ')}
            </div>
            {!g.canDecide && g.cannotDecideReason && (
              <div className="text-[12px] text-faint">{g.cannotDecideReason}</div>
            )}
          </div>
          <Button
            variant={g.canDecide ? (g.kind === 'escalation' ? 'default' : 'warn') : 'ghost'}
            onClick={() => setOpen(g)}
          >
            {g.canDecide ? 'Review and decide' : 'View'}
          </Button>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-6 px-4 py-6 md:px-8">
      <div>
        <div className="eyebrow">Approvals</div>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Decisions waiting on people</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] text-muted">
          Plans need approval before anything is built; releases need approval before the branch goes to your
          CI/CD. Escalations appear when an agent cannot continue safely on its own.
        </p>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title="Nothing is waiting"
            body="When a plan or release is ready, or an agent needs a person, it shows up here and you get a notification."
          />
        </Card>
      ) : (
        <>
          {mine.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[14px] font-semibold">For you · {mine.length}</h2>
              {list(mine)}
            </section>
          )}
          {others.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[14px] font-semibold text-muted">
                Waiting on someone else · {others.length}
              </h2>
              {list(others)}
            </section>
          )}
        </>
      )}
      <GateDialog gate={open} open={!!open} onClose={() => setOpen(null)} />
    </div>
  );
}
