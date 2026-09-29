'use client';

import { ArrowRight, CornerDownLeft, Hash } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TicketSummaryDto } from '@lsa/contracts';
import { get, qs } from '@/lib/api';
import { STATUS_LABELS } from '@/lib/format';
import { useApprovals, useMe } from '@/lib/queries';
import { cx, Kbd } from './ui';

interface Cmd {
  id: string;
  label: string;
  hint: string;
  run: () => void;
  icon?: 'ticket';
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<TicketSummaryDto[]>([]);
  const router = useRouter();
  const me = useMe().data;
  const approvals = useApprovals().data ?? [];
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('lsa:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('lsa:palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      get<TicketSummaryDto[]>(`/tickets${qs({ q: q.trim(), limit: 8, includeCancelled: true })}`)
        .then(setHits)
        .catch(() => setHits([]));
    }, 160);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (path: string) => () => {
    setOpen(false);
    router.push(path);
  };

  const commands = useMemo<Cmd[]>(() => {
    const base: Cmd[] = [
      ...(approvals.some((a) => a.canDecide)
        ? [
            {
              id: 'appr',
              label: `Review ${approvals.filter((a) => a.canDecide).length} pending approval(s)`,
              hint: 'Approvals',
              run: go('/approvals'),
            },
          ]
        : []),
      { id: 'new', label: 'Log a new requirement', hint: 'Home', run: go('/?focus=request') },
      { id: 'board', label: 'Open the board', hint: 'Board', run: go('/board') },
      { id: 'runs', label: 'See active runs', hint: 'Runs', run: go('/runs') },
      { id: 'know', label: 'Search or ask the codebase', hint: 'Knowledge', run: go('/knowledge') },
      { id: 'agents', label: 'Browse agents and skills', hint: 'Agents', run: go('/agents') },
      { id: 'projects', label: 'Projects and settings', hint: 'Projects', run: go('/projects') },
      { id: 'audit', label: 'Audit log', hint: 'Audit', run: go('/audit') },
      ...(me?.isAdmin
        ? [{ id: 'users', label: 'Manage users', hint: 'Admin', run: go('/admin/users') }]
        : []),
    ];
    const term = q.trim().toLowerCase();
    const filtered = term
      ? base.filter((c) => c.label.toLowerCase().includes(term) || c.hint.toLowerCase().includes(term))
      : base;
    const tickets: Cmd[] = hits.map((t) => ({
      id: t.id,
      label: `${t.key} · ${t.title}`,
      hint: STATUS_LABELS[t.status],
      run: go(`/tickets/${t.key}`),
      icon: 'ticket',
    }));
    return [...tickets, ...filtered];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hits, approvals, me]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(commands.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      commands[sel]?.run();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[55]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-[3px]"
            onClick={() => setOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-[14vh] left-1/2 w-[min(580px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-2 bg-panel shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
          >
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Type a ticket key, words from a title, or a command…"
              aria-label="Search"
              className="h-14 w-full border-b border-line bg-transparent px-5 text-[15px] outline-none placeholder:text-faint"
            />
            <ul className="max-h-[360px] overflow-y-auto p-2">
              {commands.length === 0 && (
                <li className="px-3 py-6 text-center text-[13px] text-faint">No matches</li>
              )}
              {commands.map((c, i) => (
                <li key={c.id}>
                  <button
                    onMouseEnter={() => setSel(i)}
                    onClick={c.run}
                    className={cx(
                      'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13.5px]',
                      i === sel && 'bg-accent/12',
                    )}
                  >
                    {c.icon === 'ticket' ? (
                      <Hash className="size-4 text-accent" />
                    ) : (
                      <ArrowRight className="size-4 text-muted" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="text-[11.5px] text-faint">{c.hint}</span>
                    {i === sel && <CornerDownLeft className="size-3.5 text-faint" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-3 border-t border-line px-4 py-2.5 text-[11.5px] text-faint">
              <span>
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
              </span>
              <span>
                <Kbd>Enter</Kbd> open
              </span>
              <span>
                <Kbd>Esc</Kbd> close
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
