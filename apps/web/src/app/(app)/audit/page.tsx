'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldX } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AGENTS, type ActivityDto } from '@lsa/contracts';
import { AgentIcon } from '@/components/agent-icon';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  ErrorBox,
  Loading,
  Select,
  errorText,
  useToast,
} from '@/components/ui';
import { dateTime } from '@/lib/format';
import { qs } from '@/lib/api';
import { get, useMe, useProjects } from '@/lib/queries';

interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

const PAGE = 200;

export default function AuditPage() {
  const me = useMe().data;
  const projects = useProjects().data ?? [];
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<ChainVerification | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['audit', projectId || 'all'],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => get<ActivityDto[]>(`/audit${qs({ projectId, before: pageParam })}`),
    getNextPageParam: (last) => (last.length < PAGE ? undefined : last[last.length - 1]!.seq),
  });
  const rows = q.data?.pages.flat() ?? [];
  const projectKey = new Map(projects.map((p) => [p.id, p.key]));

  const verify = async () => {
    setVerifying(true);
    try {
      setVerdict(await get<ChainVerification>('/audit/verify'));
    } catch (err) {
      toast(errorText(err), 'bad');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Audit log</div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">
            Everything that happened, in order
          </h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">
            Every action by a person, an agent or the system is appended here. Entries cannot be changed or
            deleted, and each one is chained to the one before it by a SHA-256 hash, so any tampering is
            detectable.
          </p>
        </div>
        <Select
          aria-label="Project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-auto"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </Select>
        {me?.isAdmin && (
          <Button variant="default" onClick={verify} loading={verifying}>
            <ShieldCheck className="size-4" /> Verify integrity
          </Button>
        )}
      </div>

      {verdict && (
        <Card className={verdict.ok ? 'border-ok/35 bg-ok/5 p-4' : 'border-bad/40 bg-bad/5 p-4'}>
          <div className="flex items-center gap-3">
            {verdict.ok ? (
              <ShieldCheck className="size-5 text-ok" />
            ) : (
              <ShieldX className="size-5 text-bad" />
            )}
            <div className="text-[13.5px]">
              {verdict.ok
                ? `Chain intact. All ${verdict.checked.toLocaleString()} entries match their hashes.`
                : `Chain broken at entry #${verdict.brokenAtSeq}: ${verdict.reason}. ${verdict.checked.toLocaleString()} entries before it are intact.`}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length}${q.hasNextPage ? '+' : ''} entries`} />
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] tracking-wider text-faint uppercase">
                  <th className="px-5 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Who</th>
                  <th className="px-3 py-2.5 font-medium">What</th>
                  <th className="px-3 py-2.5 font-medium">Where</th>
                  <th className="px-5 py-2.5 font-medium">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => (
                  <tr key={a.id} className="align-top hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-mono text-[11.5px] text-faint">{a.seq}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted">{dateTime(a.createdAt)}</td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        {a.actorType === 'agent' ? (
                          <>
                            <AgentIcon agent={a.agentKey} size={22} tone="accent" />
                            {a.agentKey ? AGENTS[a.agentKey].shortName : 'Agent'}
                          </>
                        ) : a.actor ? (
                          <>
                            <Avatar name={a.actor.name} size={22} />
                            {a.actor.name}
                          </>
                        ) : (
                          <span className="text-faint">System</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div>{a.summary}</div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-faint">{a.type}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {a.ticketKey ? (
                        <Link
                          href={`/tickets/${a.ticketKey}`}
                          className="font-mono text-[12px] text-accent hover:underline"
                        >
                          {a.ticketKey}
                        </Link>
                      ) : (
                        <span className="font-mono text-[12px] text-faint">
                          {projectKey.get(a.projectId) ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-faint" title={a.hash}>
                      {a.hash.slice(0, 10)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="px-5 py-8 text-center text-[13px] text-faint">Nothing recorded yet.</p>
            )}
            {q.hasNextPage && (
              <div className="flex justify-center border-t border-line p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={q.isFetchingNextPage}
                  onClick={() => void q.fetchNextPage()}
                >
                  Load older entries
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
