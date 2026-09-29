'use client';

import { Bug, Flame, GitBranch, MessageSquare, Search, Sparkles, SquareCheck } from 'lucide-react';
import Link from 'next/link';
import type { TicketPriority, TicketStatus, TicketSummaryDto, TicketType } from '@lsa/contracts';
import { PRIORITY_LABELS, RUN_STATUS_LABELS, STATUS_LABELS, statusTone, TYPE_LABELS } from '@/lib/format';
import { Avatar, cx, Pill } from './ui';

const TYPE_ICON: Record<TicketType, typeof Bug> = {
  feature: Sparkles,
  bug: Bug,
  hotfix: Flame,
  analysis: Search,
  task: SquareCheck,
};
const TYPE_COLOR: Record<TicketType, string> = {
  feature: 'text-accent',
  bug: 'text-bad',
  hotfix: 'text-wait',
  analysis: 'text-run',
  task: 'text-muted',
};

export function TypeBadge({ type, withLabel = true }: { type: TicketType; withLabel?: boolean }) {
  const Icon = TYPE_ICON[type];
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 text-[12px]', TYPE_COLOR[type])}
      title={TYPE_LABELS[type]}
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
      {withLabel && <span className="text-muted">{TYPE_LABELS[type]}</span>}
    </span>
  );
}

const PRIO: Record<TicketPriority, string> = {
  low: 'bg-white/20',
  medium: 'bg-run/70',
  high: 'bg-wait',
  critical: 'bg-bad',
};
export function PriorityDot({
  priority,
  withLabel = false,
}: {
  priority: TicketPriority;
  withLabel?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] text-muted"
      title={`${PRIORITY_LABELS[priority]} priority`}
    >
      <span className="flex items-end gap-[2px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{ height: 4 + i * 2.5 }}
            className={cx(
              'w-[3px] rounded-sm',
              i <= ['low', 'medium', 'high', 'critical'].indexOf(priority) ? PRIO[priority] : 'bg-white/10',
            )}
          />
        ))}
      </span>
      {withLabel && PRIORITY_LABELS[priority]}
    </span>
  );
}

export function StatusPill({ status }: { status: TicketStatus }) {
  const tone = statusTone(status);
  return (
    <Pill tone={tone} live={tone === 'run' || tone === 'wait'}>
      {STATUS_LABELS[status]}
    </Pill>
  );
}

/** Board card. Shows what needs attention without opening the ticket. */
export function TicketCard({ t, dragging }: { t: TicketSummaryDto; dragging?: boolean }) {
  const running = t.activeRun && ['running', 'queued'].includes(t.activeRun.status);
  return (
    <Link
      href={`/tickets/${t.key}`}
      draggable={false}
      className={cx(
        'group relative block overflow-hidden rounded-[14px] border bg-panel-2 p-3 transition',
        dragging
          ? 'rotate-[1.5deg] border-accent/50 shadow-[0_20px_50px_rgba(0,0,0,0.45)]'
          : 'border-line-2 hover:-translate-y-px hover:border-white/25',
        t.pendingGate && t.pendingGate !== 'escalation' && 'border-wait/45',
        t.status === 'blocked' && 'border-bad/45',
      )}
    >
      {running && <span className="shine-run absolute inset-x-0 top-0 h-[2px]" />}
      <div className="flex items-center gap-2">
        <TypeBadge type={t.type} withLabel={false} />
        <span className="font-mono text-[11px] text-faint">{t.key}</span>
        <span className="ml-auto">
          <PriorityDot priority={t.priority} />
        </span>
      </div>
      <div className="mt-1.5 line-clamp-3 text-[13.5px] leading-snug font-medium">{t.title}</div>
      {(t.pendingGate || t.activeRun) && (
        <div className="mt-2">
          {t.pendingGate === 'escalation' ? (
            <Pill tone="bad" live>
              Needs a person
            </Pill>
          ) : t.pendingGate ? (
            <Pill tone="wait" live>
              {t.pendingGate === 'plan' ? 'Approve plan' : 'Approve release'}
            </Pill>
          ) : t.activeRun ? (
            <Pill
              tone={t.activeRun.status === 'paused' ? 'idle' : 'run'}
              live={t.activeRun.status === 'running'}
            >
              {RUN_STATUS_LABELS[t.activeRun.status]}
            </Pill>
          ) : null}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-faint">
        {t.labels.slice(0, 2).map((l) => (
          <span key={l} className="truncate rounded-md bg-white/5 px-1.5 py-0.5 text-muted">
            {l}
          </span>
        ))}
        {t.parentKey && (
          <span className="inline-flex items-center gap-1 truncate">
            <GitBranch className="size-3" /> {t.parentKey}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {t.commentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" /> {t.commentCount}
            </span>
          )}
          {t.childCount > 0 && <span title="Defects found during runs">{t.childCount} sub</span>}
          {t.assignee && <Avatar name={t.assignee.name} size={20} />}
        </span>
      </div>
    </Link>
  );
}

/** Compact row for lists (home, runs). */
export function TicketRow({ t }: { t: TicketSummaryDto }) {
  return (
    <Link
      href={`/tickets/${t.key}`}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.03]"
    >
      <TypeBadge type={t.type} withLabel={false} />
      <span className="w-[72px] shrink-0 font-mono text-[11.5px] text-faint">{t.key}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px]">{t.title}</span>
      <StatusPill status={t.status} />
    </Link>
  );
}
