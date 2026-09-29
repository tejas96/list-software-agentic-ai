'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RealtimeEvent } from '@lsa/contracts';

/** Same origin by default (proxied by Next); set NEXT_PUBLIC_SOCKET_URL only to reach the API directly. */
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;

interface RealtimeCtx {
  socket: Socket | null;
  connected: boolean;
}
const Ctx = createContext<RealtimeCtx>({ socket: null, connected: false });

/**
 * One Socket.IO connection per tab. Events only say what changed; the
 * matching queries are invalidated and refetched, so the UI never shows
 * data the REST API would not.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = io(SOCKET_URL, {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('event', (e: RealtimeEvent) => {
      switch (e.type) {
        case 'notification.added':
          void qc.invalidateQueries({ queryKey: ['notifications'] });
          return;
        case 'source.changed':
          void qc.invalidateQueries({ queryKey: ['sources', e.projectId] });
          return;
      }
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['runs', 'active'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      if ('ticketId' in e && e.ticketId) {
        // Ticket queries are keyed by key or id; invalidate broadly but cheaply.
        void qc.invalidateQueries({ queryKey: ['ticket'] });
        void qc.invalidateQueries({ queryKey: ['timeline'] });
        if (e.type === 'comment.added') void qc.invalidateQueries({ queryKey: ['comments'] });
        void qc.invalidateQueries({ queryKey: ['evidence'] });
      }
      if ('runId' in e && e.runId) void qc.invalidateQueries({ queryKey: ['run', e.runId] });
    });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [qc]);

  return <Ctx.Provider value={{ socket, connected }}>{children}</Ctx.Provider>;
}

export function useRealtime(): RealtimeCtx {
  return useContext(Ctx);
}

/** Subscribe to a room (e.g. `project:<id>`) for as long as the component is mounted. */
export function useRoom(room: string | null | undefined): void {
  const { socket, connected } = useRealtime();
  const joined = useRef<string | null>(null);
  useEffect(() => {
    if (!socket || !connected || !room) return;
    socket.emit('subscribe', { room });
    joined.current = room;
    return () => {
      socket.emit('unsubscribe', { room });
      joined.current = null;
    };
  }, [socket, connected, room]);
}
