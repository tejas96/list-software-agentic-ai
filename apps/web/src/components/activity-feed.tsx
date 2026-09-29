'use client';

import {
  CircleCheck,
  CircleX,
  GitBranch,
  MessageSquare,
  ShieldCheck,
  TriangleAlert,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { AGENTS, type ActivityDto } from '@lsa/contracts';
import { ago, dateTime } from '@/lib/format';
import { AgentIcon } from './agent-icon';
import { cx } from './ui';

function toneOf(type: string): 'bad' | 'ok' | 'wait' | null {
  if (
    type.endsWith('.failed') ||
    type === 'run.blocked' ||
    type === 'qa.failed' ||
    type === 'defect.logged' ||
    type === 'budget.exceeded'
  )
    return 'bad';
  if (type === 'qa.passed' || type === 'run.succeeded' || type === 'defect.resolved') return 'ok';
  if (type === 'gate.opened') return 'wait';
  return null;
}

function Who({ a }: { a: ActivityDto }) {
  if (a.actorType === 'agent' && a.agentKey)
    return <AgentIcon agent={a.agentKey} size={30} tone={toneOf(a.type) === 'bad' ? 'bad' : 'idle'} />;
  const Icon = a.type.startsWith('gate')
    ? ShieldCheck
    : a.type.startsWith('comment')
      ? MessageSquare
      : a.actorType === 'user'
        ? User
        : a.type.startsWith('run')
          ? GitBranch
          : a.type.includes('fail')
            ? TriangleAlert
            : CircleCheck;
  return (
    <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] border border-line bg-panel-3 text-muted">
      <Icon className="size-3.5" />
    </span>
  );
}

/** A readable, newest-last (or newest-first) list of audit entries. */
export function ActivityFeed({
  items,
  showTicket = false,
  compact = false,
  empty = 'Nothing has happened yet.',
}: {
  items: ActivityDto[];
  showTicket?: boolean;
  compact?: boolean;
  empty?: string;
}) {
  if (items.length === 0) return <p className="px-4 py-6 text-center text-[13px] text-faint">{empty}</p>;
  return (
    <ul className="flex flex-col">
      {items.map((a, i) => {
        const tone = toneOf(a.type);
        const who =
          a.actorType === 'agent' && a.agentKey
            ? AGENTS[a.agentKey].name
            : (a.actor?.name ?? (a.actorType === 'system' ? 'Platform' : 'Someone'));
        return (
          <li
            key={a.id}
            className={cx(
              'grid grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-3 rounded-[10px] px-2.5 hover:bg-white/[0.02]',
              compact ? 'py-2' : 'py-2.5',
              i < 12 && 'animate-rise',
            )}
          >
            <Who a={a} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <span>{who}</span>
                {showTicket && a.ticketKey && (
                  <Link
                    href={`/tickets/${a.ticketKey}`}
                    className="font-mono text-[11px] text-accent hover:underline"
                  >
                    {a.ticketKey}
                  </Link>
                )}
              </div>
              <div
                className={cx(
                  'text-[13.5px] leading-snug break-words',
                  tone === 'bad' && 'text-bad',
                  tone === 'ok' && 'text-ok',
                )}
              >
                {a.summary}
              </div>
            </div>
            <time
              title={dateTime(a.createdAt)}
              className="pt-0.5 font-mono text-[10.5px] whitespace-nowrap text-faint"
            >
              {ago(a.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

export { CircleX };
