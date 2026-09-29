'use client';

import { ArrowRight, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { GateDto, TicketDto } from '@lsa/contracts';
import { ActivityFeed } from '@/components/activity-feed';
import { GateCard, GateDialog } from '@/components/gate';
import { Orb } from '@/components/orb';
import { TicketRow } from '@/components/ticket-bits';
import {
  Button,
  Card,
  CardHeader,
  cx,
  EmptyState,
  errorText,
  Loading,
  Pill,
  Select,
  Toggle,
  useToast,
} from '@/components/ui';
import { ago, RUN_STATUS_LABELS, runTone } from '@/lib/format';
import { useCurrentProject } from '@/lib/project';
import { keys, post, useAction, useDashboard, useMe } from '@/lib/queries';

export default function HomePage() {
  const me = useMe().data;
  const dash = useDashboard();
  const { project, projects, setProject, isLoading } = useCurrentProject();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [text, setText] = useState('');
  const [startRun, setStartRun] = useState(false);
  const [gate, setGate] = useState<GateDto | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (params.get('focus') === 'request') area.current?.focus();
  }, [params]);

  const intake = useAction(
    (v: { projectId: string; text: string; startRun: boolean }) => post<TicketDto>('/tickets/intake', v),
    [['tickets'], keys.dashboard],
  );

  const canCreate = project && project.myRole && project.myRole !== 'viewer';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!project || text.trim().length < 5) return;
    try {
      const t = await intake.mutateAsync({ projectId: project.id, text: text.trim(), startRun });
      toast(`Logged ${t.key}${startRun ? ' and started the run' : ''}. The agents are triaging it.`);
      setText('');
      router.push(`/tickets/${t.key}`);
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };

  const d = dash.data;
  const firstName = me?.name.split(' ')[0];

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-4 py-8 md:px-8">
      <section className="flex flex-col items-center gap-5 text-center">
        <div className="animate-rise">
          <Orb size={230} />
        </div>
        <h1
          className="-mt-4 animate-rise text-[34px] leading-tight font-semibold tracking-tight [text-wrap:balance] md:text-[40px]"
          style={{ animationDelay: '80ms' }}
        >
          What should the team change{firstName ? `, ${firstName}` : ''}?
        </h1>
        <p
          className="max-w-[580px] animate-rise text-[15px] leading-relaxed text-muted [text-wrap:balance]"
          style={{ animationDelay: '140ms' }}
        >
          Describe it in plain words. It is logged on the board, triaged, analysed against the real system,
          planned and tested. Nothing is built or released until you approve.
        </p>
      </section>

      {!isLoading && projects.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon={<Workflow className="size-5" />}
            title="No projects yet"
            body={
              me?.isAdmin
                ? 'Create a project for each client system, add people, and connect its repository.'
                : 'Ask a workspace administrator to add you to a project.'
            }
            action={
              me?.isAdmin ? (
                <Link href="/projects">
                  <Button variant="primary">Create a project</Button>
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <form
          onSubmit={submit}
          className="mx-auto flex w-full max-w-[780px] animate-rise flex-col gap-3 rounded-[20px] border border-line-2 bg-panel p-4 shadow-[0_30px_80px_-30px_rgba(161,149,255,0.25)] transition focus-within:border-accent/50 focus-within:shadow-[0_30px_80px_-24px_rgba(161,149,255,0.4)]"
          style={{ animationDelay: '200ms' }}
        >
          <div className="flex items-center gap-2 px-1.5">
            <label htmlFor="req" className="eyebrow">
              New requirement
            </label>
            <div className="ml-auto flex items-center gap-2">
              <label htmlFor="proj" className="text-[12px] text-faint">
                Project
              </label>
              <Select
                id="proj"
                value={project?.key ?? ''}
                onChange={(e) => setProject(e.target.value)}
                className="h-8 w-auto py-0 text-[12.5px]"
              >
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.key} · {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <textarea
            id="req"
            ref={area}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(e as unknown as FormEvent);
            }}
            disabled={!canCreate}
            placeholder={
              canCreate
                ? 'e.g. Add a customer-address field to the account-opening process, validated and shown on the customer summary report.'
                : 'You have view-only access to this project.'
            }
            className="w-full resize-none bg-transparent px-1.5 text-[16px] leading-relaxed outline-none placeholder:text-faint"
          />
          <div className="flex flex-wrap items-center gap-2">
            {project?.techStack.map((t) => (
              <span
                key={t}
                className="rounded-[9px] border border-accent/35 bg-accent/10 px-2.5 py-1 text-[12px]"
              >
                {t}
              </span>
            ))}
            <div className="flex-1" />
            <Toggle checked={startRun} onChange={setStartRun} label="Start the run right away" />
            <Button
              type="submit"
              variant="primary"
              loading={intake.isPending}
              disabled={!canCreate || text.trim().length < 5}
            >
              Log it <ArrowRight className="size-4" />
            </Button>
          </div>
        </form>
      )}

      {dash.isLoading ? (
        <Loading />
      ) : d ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ['Open', d.totals.open, 'idle'],
                ['In progress', d.totals.inProgress, 'run'],
                ['Waiting approval', d.totals.awaitingApproval, 'wait'],
                ['Blocked', d.totals.blocked, 'bad'],
                ['Done this week', d.totals.doneThisWeek, 'ok'],
              ].map(([label, n, tone]) => (
                <Link
                  key={label as string}
                  href="/board"
                  className="rounded-2xl border border-line bg-panel px-4 py-3.5 transition hover:border-white/20"
                >
                  <div
                    className={cx(
                      'text-[24px] font-semibold tabular-nums',
                      tone === 'run' && 'text-run',
                      tone === 'wait' && 'text-wait',
                      tone === 'bad' && 'text-bad',
                      tone === 'ok' && 'text-ok',
                    )}
                  >
                    {n}
                  </div>
                  <div className="text-[12px] text-muted">{label}</div>
                </Link>
              ))}
            </div>
            <Card>
              <CardHeader
                title="Active runs"
                right={
                  <Link href="/runs" className="text-[12.5px] text-accent hover:underline">
                    All runs
                  </Link>
                }
              />
              <div className="p-2">
                {d.activeRuns.length === 0 && (
                  <p className="px-3 py-5 text-center text-[13px] text-faint">No runs in progress.</p>
                )}
                {d.activeRuns.slice(0, 8).map((r) => (
                  <Link
                    key={r.id}
                    href={`/runs/${r.id}`}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.03]"
                  >
                    <span className="w-[72px] shrink-0 font-mono text-[11.5px] text-faint">
                      {r.ticketKey}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">
                      {r.workflowType.replace('_', ' ')} · started {ago(r.startedAt)}
                    </span>
                    <Pill tone={runTone(r.status)} live={r.status === 'running'}>
                      {RUN_STATUS_LABELS[r.status]}
                      {r.currentStage ? ` · ${r.currentStage}` : ''}
                    </Pill>
                  </Link>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Assigned to you"
                right={
                  <Link href="/board?mine=1" className="text-[12.5px] text-accent hover:underline">
                    Board
                  </Link>
                }
              />
              <div className="p-2">
                {d.myTickets.length === 0 && (
                  <p className="px-3 py-5 text-center text-[13px] text-faint">Nothing assigned to you.</p>
                )}
                {d.myTickets.map((t) => (
                  <TicketRow key={t.id} t={t} />
                ))}
              </div>
            </Card>
          </div>
          <div className="flex flex-col gap-5">
            {d.needsMe.length > 0 ? (
              d.needsMe.slice(0, 3).map((g) => <GateCard key={g.id} gate={g} onOpen={() => setGate(g)} />)
            ) : (
              <Card className="p-5">
                <Pill tone="idle">Nothing needs you</Pill>
                <div className="mt-3 text-[16px] font-semibold">You’re up to date</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                  You’ll be asked to decide only at the gates, or when an agent needs a person.
                </p>
              </Card>
            )}
            {d.blocked.length > 0 && (
              <Card>
                <CardHeader title="Blocked" />
                <div className="p-2">
                  {d.blocked.map((t) => (
                    <TicketRow key={t.id} t={t} />
                  ))}
                </div>
              </Card>
            )}
            <Card>
              <CardHeader
                title="Recent activity"
                right={
                  <Link href="/audit" className="text-[12.5px] text-accent hover:underline">
                    Audit log
                  </Link>
                }
              />
              <div className="max-h-[520px] overflow-y-auto p-2">
                <ActivityFeed items={d.recent} showTicket compact />
              </div>
            </Card>
          </div>
        </div>
      ) : null}
      <GateDialog gate={gate} open={!!gate} onClose={() => setGate(null)} />
    </div>
  );
}
