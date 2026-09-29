'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { ago } from '@/lib/format';
import { keys, useMe, useNotifications } from '@/lib/queries';
import { Avatar, cx, Kbd } from './ui';

export function openPalette() {
  window.dispatchEvent(new CustomEvent('lsa:palette'));
}

export function Topbar() {
  const me = useMe().data;
  const notes = useNotifications().data;
  const [openNotes, setOpenNotes] = useState(false);
  const [openUser, setOpenUser] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpenNotes(false);
        setOpenUser(false);
      }
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);

  const signOut = async () => {
    await post('/auth/logout');
    qc.clear();
    router.replace('/login');
  };

  const readAll = async () => {
    await post('/notifications/read-all');
    await qc.invalidateQueries({ queryKey: keys.notifications });
  };

  const openNote = async (id: string, link: string | null) => {
    await post(`/notifications/${id}/read`);
    await qc.invalidateQueries({ queryKey: keys.notifications });
    setOpenNotes(false);
    if (link) router.push(link);
  };

  return (
    <header
      className="relative z-20 flex h-[60px] shrink-0 items-center gap-3 border-b border-line px-4 md:px-7"
      ref={box}
    >
      <button
        onClick={openPalette}
        className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-line-2 bg-panel px-3 text-[13.5px] text-muted transition hover:border-accent/40 md:max-w-[420px]"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search tickets, run commands…</span>
        <span className="ml-auto hidden sm:inline">
          <Kbd>⌘K</Kbd>
        </span>
      </button>
      <div className="flex-1" />
      <div className="relative">
        <button
          aria-label="Notifications"
          onClick={() => setOpenNotes((v) => !v)}
          className="relative grid size-9 place-items-center rounded-[10px] border border-line-2 bg-panel transition hover:border-accent/40"
        >
          <Bell className="size-4" />
          {notes && notes.unread > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-wait px-1 font-mono text-[10px] font-semibold text-[#231703]">
              {notes.unread > 99 ? '99+' : notes.unread}
            </span>
          )}
        </button>
        <AnimatePresence>
          {openNotes && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="absolute right-0 mt-2 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-line-2 bg-panel shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
            >
              <div className="flex items-center border-b border-line px-4 py-3">
                <span className="text-[13.5px] font-semibold">Notifications</span>
                {notes && notes.unread > 0 && (
                  <button onClick={readAll} className="ml-auto text-[12px] text-accent hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              <ul className="max-h-[420px] overflow-y-auto p-1.5">
                {(notes?.items ?? []).length === 0 && (
                  <li className="px-3 py-6 text-center text-[13px] text-faint">
                    Nothing yet. You’ll hear about approvals, blockers and finished runs here.
                  </li>
                )}
                {(notes?.items ?? []).map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openNote(n.id, n.link)}
                      className="flex w-full gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.03]"
                    >
                      <span
                        className={cx(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          n.readAt
                            ? 'bg-transparent'
                            : n.type.includes('blocked')
                              ? 'bg-bad'
                              : n.type.includes('gate')
                                ? 'bg-wait'
                                : 'bg-accent',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-snug">{n.title}</span>
                        {n.body && (
                          <span className="mt-0.5 block truncate text-[12px] text-muted">{n.body}</span>
                        )}
                        <span className="mt-1 block font-mono text-[10.5px] text-faint">
                          {ago(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="relative">
        <button aria-label="Account menu" onClick={() => setOpenUser((v) => !v)} className="rounded-full">
          <Avatar name={me?.name ?? '?'} size={34} />
        </button>
        <AnimatePresence>
          {openUser && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-line-2 bg-panel p-1.5 shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
            >
              <div className="px-3 py-2.5">
                <div className="text-[13.5px] font-semibold">{me?.name}</div>
                <div className="truncate text-[12px] text-muted">{me?.email}</div>
                {me?.isAdmin && (
                  <div className="mt-1 font-mono text-[10.5px] text-accent uppercase">Workspace admin</div>
                )}
              </div>
              <Link
                href="/account"
                onClick={() => setOpenUser(false)}
                className="block rounded-xl px-3 py-2 text-[13px] hover:bg-white/[0.04]"
              >
                Account and password
              </Link>
              <button
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] hover:bg-white/[0.04]"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
