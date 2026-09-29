'use client';

import { useRouter } from 'next/navigation';
import { Suspense, useEffect, type ReactNode } from 'react';
import { CommandPalette } from '@/components/command-palette';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { RealtimeProvider } from '@/lib/realtime';

export default function AppLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [me.error, router]);

  if (!me.data) {
    return (
      <div className="grid h-full place-items-center">
        <Loading label="Signing you in" />
      </div>
    );
  }

  return (
    <RealtimeProvider>
      <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[232px_minmax(0,1fr)] md:grid-rows-1">
        <Suspense>
          <Sidebar />
        </Suspense>
        <div className="relative flex min-h-0 min-w-0 flex-col">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(600px_260px_at_70%_-40px,rgba(161,149,255,0.09),transparent_70%)]" />
          <Topbar />
          <main className="relative z-[1] min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<Loading />}>{children}</Suspense>
          </main>
        </div>
      </div>
      <CommandPalette />
    </RealtimeProvider>
  );
}
