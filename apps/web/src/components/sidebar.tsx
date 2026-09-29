'use client';

import {
  BookOpen,
  Bot,
  Boxes,
  House,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  SquareKanban,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useApprovals, useMe, useWorkspaceStatus } from '@/lib/queries';
import { useRealtime } from '@/lib/realtime';
import { cx } from './ui';

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  hot?: boolean;
  keepProject?: boolean;
}

export function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="28" height="28" rx="9" fill="#12161F" stroke="rgba(161,149,255,.45)" />
      <circle cx="15" cy="9.5" r="2.6" fill="#A195FF" />
      <circle cx="9" cy="19.5" r="2.6" fill="#E9EBF3" />
      <circle cx="21" cy="19.5" r="2.6" fill="#E9EBF3" />
      <path
        d="M13.7 11.8l-3.4 5.4M16.3 11.8l3.4 5.4M11.8 19.5h6.4"
        stroke="rgba(233,235,243,.45)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const me = useMe().data;
  const approvals = useApprovals().data ?? [];
  const status = useWorkspaceStatus().data;
  const { connected } = useRealtime();
  const actionable = approvals.filter((a) => a.canDecide).length;
  const project = params.get('project');

  const work: Item[] = [
    { href: '/', label: 'Home', icon: House },
    { href: '/board', label: 'Board', icon: SquareKanban, keepProject: true },
    { href: '/runs', label: 'Runs', icon: Workflow },
    { href: '/approvals', label: 'Approvals', icon: ShieldCheck, badge: actionable, hot: actionable > 0 },
    { href: '/knowledge', label: 'Knowledge', icon: Network, keepProject: true },
    { href: '/agents', label: 'Agents', icon: Bot },
  ];
  const manage: Item[] = [
    { href: '/projects', label: 'Projects', icon: Boxes },
    { href: '/audit', label: 'Audit log', icon: ScrollText },
    ...(me?.isAdmin ? [{ href: '/admin/users', label: 'Users', icon: Users }] : []),
    { href: '/account', label: 'Account', icon: Settings },
  ];

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const link = (i: Item) => {
    const href = i.keepProject && project ? `${i.href}?project=${project}` : i.href;
    const active = isActive(i.href);
    return (
      <Link
        key={i.href}
        href={href}
        className={cx(
          'flex h-[38px] shrink-0 items-center gap-3 rounded-[10px] border px-2.5 text-[13.5px] transition',
          active
            ? 'border-accent/30 bg-accent/10 text-text'
            : 'border-transparent text-muted hover:bg-white/[0.035] hover:text-text',
        )}
      >
        <i.icon className={cx('size-[17px] shrink-0', active && 'text-accent')} strokeWidth={1.7} />
        <span className="hidden md:inline">{i.label}</span>
        {i.badge ? (
          <span
            className={cx(
              'ml-auto rounded-full px-1.5 font-mono text-[10.5px] leading-5',
              i.hot ? 'bg-wait font-semibold text-[#231703]' : 'bg-white/6 text-muted',
            )}
          >
            {i.badge}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <aside className="flex items-center gap-2 overflow-x-auto border-b border-line bg-panel px-4 py-2.5 md:flex-col md:items-stretch md:gap-5 md:overflow-visible md:border-r md:border-b-0 md:bg-[linear-gradient(180deg,rgba(161,149,255,0.035),transparent_40%),var(--color-panel)] md:px-3.5 md:py-5">
      <Link href="/" className="flex shrink-0 items-center gap-2.5 px-1.5 md:pb-1">
        <Logo />
        <span className="hidden md:block">
          <b className="block text-[14.5px] font-semibold tracking-tight">List Software</b>
          <small className="block font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">
            Agentic engineering
          </small>
        </span>
      </Link>
      <nav className="flex gap-1 md:flex-col md:gap-0.5" aria-label="Workspace">
        <div className="eyebrow hidden px-2.5 pb-2 md:block">Work</div>
        {work.map(link)}
      </nav>
      <nav className="flex gap-1 md:flex-col md:gap-0.5" aria-label="Manage">
        <div className="eyebrow hidden px-2.5 pb-2 md:block">Manage</div>
        {manage.map(link)}
      </nav>
      <div className="mt-auto hidden flex-col gap-2 rounded-xl border border-line bg-panel-2 p-3.5 md:flex">
        <StatusRow ok={connected} label={connected ? 'Live updates on' : 'Live updates reconnecting'} />
        <StatusRow
          ok={status?.temporal.connected ?? false}
          label={status?.temporal.connected ? 'Workflow engine connected' : 'Workflow engine unreachable'}
        />
        <StatusRow
          ok={status?.llm.configured ?? false}
          label={status?.llm.configured ? `Agents ready (${status.llm.model})` : 'Agents need an LLM key'}
          warn
        />
        <StatusRow
          ok={!!status && status.oracleTooling.forms && status.oracleTooling.reports}
          label={
            !status || (!status.oracleTooling.forms && !status.oracleTooling.reports)
              ? 'Oracle tools not set up'
              : status.oracleTooling.forms && status.oracleTooling.reports
                ? 'Oracle tools ready'
                : `Oracle ${status.oracleTooling.forms ? 'Reports' : 'Forms'} tools missing`
          }
          warn
        />
        <Link
          href="/agents"
          className="mt-1 flex items-center gap-1.5 text-[12px] text-accent hover:underline"
        >
          <BookOpen className="size-3.5" /> How the agents work
        </Link>
      </div>
    </aside>
  );
}

function StatusRow({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <span className={cx('size-1.5 shrink-0 rounded-full', ok ? 'bg-ok' : warn ? 'bg-wait' : 'bg-bad')} />
      <span className="truncate">{label}</span>
    </div>
  );
}
