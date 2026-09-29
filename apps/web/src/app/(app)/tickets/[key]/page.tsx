'use client';

import {
  Copy,
  GitBranch,
  Pause,
  Pencil,
  Play,
  Plus,
  ScrollText,
  Send,
  Sparkles,
  Square,
  Trash,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  AGENTS,
  DEFAULT_WORKFLOW_BY_TYPE,
  STATUS_LABELS,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  WORKFLOWS,
  type GateDto,
  type TicketDto,
  type WorkflowType,
} from '@lsa/contracts';
import { ActivityFeed } from '@/components/activity-feed';
import { AgentIcon } from '@/components/agent-icon';
import { GateCard, GateDialog } from '@/components/gate';
import { PriorityDot, StatusPill, TypeBadge } from '@/components/ticket-bits';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  cx,
  ErrorBox,
  Input,
  Loading,
  Modal,
  Pill,
  Select,
  Tabs,
  Textarea,
  errorText,
  useToast,
} from '@/components/ui';
import { ago, dateTime, money, PRIORITY_LABELS, RUN_STATUS_LABELS, runTone, TYPE_LABELS } from '@/lib/format';
import {
  keys,
  patch,
  post,
  useAction,
  useApprovals,
  useComments,
  useMembers,
  useProject,
  useTicket,
  useTimeline,
} from '@/lib/queries';
import { useRoom } from '@/lib/realtime';

type Tab = 'overview' | 'activity' | 'comments' | 'runs';

export default function TicketPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const ticket = useTicket(key);
  const [tab, setTab] = useState<Tab>('overview');
  useRoom(ticket.data ? `ticket:${ticket.data.id}` : null);

  if (ticket.isLoading) return <Loading />;
  if (ticket.error || !ticket.data)
    return (
      <div className="p-8">
        <ErrorBox error={ticket.error} />
      </div>
    );
  const t = ticket.data;
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5 px-4 py-6 md:px-8">
      <Header t={t} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Banners t={t} />
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'activity', label: 'Timeline' },
              { id: 'comments', label: `Comments${t.commentCount ? ` · ${t.commentCount}` : ''}` },
              { id: 'runs', label: `Runs${t.runs.length ? ` · ${t.runs.length}` : ''}` },
            ]}
          />
          {tab === 'overview' && <Overview t={t} />}
          {tab === 'activity' && <Timeline ticketKey={t.key} />}
          {tab === 'comments' && <Comments t={t} />}
          {tab === 'runs' && <Runs t={t} />}
        </div>
        <Sidebar t={t} />
      </div>
    </div>
  );
}

function useCanEdit(t: TicketDto) {
  const project = useProject(t.projectKey).data;
  return { canEdit: !!project?.myRole && project.myRole !== 'viewer', project };
}

function Header({ t }: { t: TicketDto }) {
  const toast = useToast();
  const { canEdit } = useCanEdit(t);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [runOpen, setRunOpen] = useState(false);
  const save = useAction(
    (v: { title: string }) => patch<TicketDto>(`/tickets/${t.key}`, { version: t.version, ...v }),
    [keys.ticket(t.key), ['tickets']],
  );
  const control = useAction(
    (action: string) => post(`/runs/${t.activeRun!.id}/control`, { action }),
    [keys.ticket(t.key), ['run']],
  );

  const doControl = async (action: 'pause' | 'resume' | 'cancel') => {
    try {
      await control.mutateAsync(action);
      toast(
        action === 'pause'
          ? 'Pausing after the current step'
          : action === 'resume'
            ? 'Run resumed'
            : 'Cancelling the run',
      );
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };

  const closed = t.status === 'done' || t.status === 'cancelled';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href={`/board?project=${t.projectKey}`} className="eyebrow hover:text-text">
          {t.projectKey} · Board
        </Link>
        <span className="text-faint">/</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(t.key).catch(() => undefined);
            toast(`Copied ${t.key}`);
          }}
          className="inline-flex items-center gap-1.5 font-mono text-[12px] text-muted hover:text-text"
        >
          {t.key} <Copy className="size-3" />
        </button>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await save.mutateAsync({ title: title.trim() });
                  setEditing(false);
                } catch (err) {
                  toast(errorText(err), 'bad');
                }
              }}
              className="flex gap-2"
            >
              <Input
                aria-label="Title"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-[18px]"
              />
              <Button type="submit" variant="primary" loading={save.isPending}>
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <h1 className="group flex items-start gap-2 text-[26px] leading-tight font-semibold tracking-tight [text-wrap:balance]">
              {t.title}
              {canEdit && (
                <button
                  aria-label="Edit title"
                  onClick={() => {
                    setTitle(t.title);
                    setEditing(true);
                  }}
                  className="mt-2 opacity-0 transition group-hover:opacity-100"
                >
                  <Pencil className="size-4 text-muted" />
                </button>
              )}
            </h1>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <StatusPill status={t.status} />
            <TypeBadge type={t.type} />
            <PriorityDot priority={t.priority} withLabel />
            {t.labels.map((l) => (
              <span key={l} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[12px] text-muted">
                {l}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.activeRun ? (
            <>
              <Link href={`/runs/${t.activeRun.id}`}>
                <Button variant="primary">
                  <Workflow className="size-4" /> Open pipeline
                </Button>
              </Link>
              {canEdit &&
                (t.activeRun.status === 'paused' ? (
                  <Button variant="ghost" onClick={() => doControl('resume')}>
                    <Play className="size-4" /> Resume
                  </Button>
                ) : (
                  ['running', 'queued', 'awaiting_approval'].includes(t.activeRun.status) && (
                    <Button variant="ghost" onClick={() => doControl('pause')}>
                      <Pause className="size-4" /> Pause
                    </Button>
                  )
                ))}
              {canEdit && (
                <Button variant="ghost" onClick={() => doControl('cancel')}>
                  <Square className="size-4" /> Cancel run
                </Button>
              )}
            </>
          ) : (
            canEdit &&
            !closed && (
              <Button variant="primary" onClick={() => setRunOpen(true)} disabled={!!t.duplicateOf}>
                <Sparkles className="size-4" /> Start agent run
              </Button>
            )
          )}
          <Link href={`/evidence/${t.key}`}>
            <Button variant="ghost">
              <ScrollText className="size-4" /> Evidence
            </Button>
          </Link>
        </div>
      </div>
      <StartRunModal t={t} open={runOpen} onClose={() => setRunOpen(false)} />
    </div>
  );
}

function StartRunModal({ t, open, onClose }: { t: TicketDto; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { project } = useCanEdit(t);
  const defaultWf = project?.settings.workflowByType[t.type] ?? DEFAULT_WORKFLOW_BY_TYPE[t.type];
  const [wf, setWf] = useState<WorkflowType>(defaultWf);
  const start = useAction(
    (v: { ticketId: string; workflowType: WorkflowType }) => post('/runs', v),
    [keys.ticket(t.key), ['tickets'], keys.dashboard],
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start an agent run"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={start.isPending}
            onClick={async () => {
              try {
                await start.mutateAsync({ ticketId: t.id, workflowType: wf });
                toast('Run started');
                onClose();
              } catch (err) {
                toast(errorText(err), 'bad');
              }
            }}
          >
            <Sparkles className="size-4" /> Start run
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {Object.values(WORKFLOWS).map((w) => (
          <label
            key={w.type}
            className={cx(
              'flex cursor-pointer gap-3 rounded-xl border p-4 transition',
              wf === w.type ? 'border-accent/50 bg-accent/8' : 'border-line-2 hover:border-white/25',
            )}
          >
            <input
              type="radio"
              name="wf"
              className="mt-1 accent-[#a195ff]"
              checked={wf === w.type}
              onChange={() => setWf(w.type)}
            />
            <span className="flex flex-col gap-1">
              <span className="text-[14px] font-semibold">
                {w.name}{' '}
                {w.type === defaultWf && (
                  <span className="ml-1 font-mono text-[10.5px] text-accent uppercase">
                    default for {TYPE_LABELS[t.type]}
                  </span>
                )}
              </span>
              <span className="text-[13px] text-muted">{w.description}</span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                {w.stages.map((s) => (
                  <span key={s.key} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11.5px] text-muted">
                    {s.gateBefore ? '◆ ' : ''}
                    {s.name}
                  </span>
                ))}
              </span>
            </span>
          </label>
        ))}
        {project && (
          <p className="text-[12.5px] text-faint">
            Budget {money(project.settings.runBudgetUsd)} per run · up to {project.settings.qaMaxAttempts}{' '}
            test-and-fix cycles · gates: plan {project.settings.gates.plan ? 'on' : 'off'}, release{' '}
            {project.settings.gates.release ? 'on' : 'off'}.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Banners({ t }: { t: TicketDto }) {
  const toast = useToast();
  const approvals = useApprovals().data ?? [];
  const [gate, setGate] = useState<GateDto | null>(null);
  const pending = approvals.filter((g) => g.ticketId === t.id);
  const notDup = useAction(() => post(`/tickets/${t.key}/not-duplicate`), [keys.ticket(t.key)]);
  return (
    <>
      {pending.map((g) => (
        <GateCard key={g.id} gate={g} onOpen={() => setGate(g)} />
      ))}
      {t.duplicateOf && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-wait/35 bg-wait/6 px-4 py-3 text-[13.5px]">
          <TriangleAlert className="size-4 text-wait" />
          <span className="min-w-0 flex-1">
            Possible duplicate of{' '}
            <Link href={`/tickets/${t.duplicateOf.key}`} className="text-accent hover:underline">
              {t.duplicateOf.key} · {t.duplicateOf.title}
            </Link>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await notDup.mutateAsync(undefined);
                toast('Marked as not a duplicate');
              } catch (err) {
                toast(errorText(err), 'bad');
              }
            }}
          >
            It’s not a duplicate
          </Button>
        </div>
      )}
      {t.triage.state === 'pending' && (
        <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/6 px-4 py-3 text-[13.5px]">
          <AgentIcon agent="requirement_analyst" tone="accent" size={28} />
          The Requirement Analyst is triaging this ticket: type, priority, acceptance criteria and duplicates.
        </div>
      )}
      {(t.triage.state === 'skipped' || t.triage.state === 'failed') && t.triage.note && (
        <div className="rounded-xl border border-line bg-panel px-4 py-3 text-[13px] text-muted">
          {t.triage.note}
        </div>
      )}
      <GateDialog gate={gate} open={!!gate} onClose={() => setGate(null)} />
    </>
  );
}

function Overview({ t }: { t: TicketDto }) {
  const toast = useToast();
  const { canEdit } = useCanEdit(t);
  const [editDesc, setEditDesc] = useState(false);
  const [desc, setDesc] = useState(t.description);
  const [editAc, setEditAc] = useState(false);
  const [ac, setAc] = useState(t.acceptanceCriteria.map((c) => c.text));
  const save = useAction(
    (v: Record<string, unknown>) => patch<TicketDto>(`/tickets/${t.key}`, { version: t.version, ...v }),
    [keys.ticket(t.key), keys.timeline(t.key)],
  );
  const run = async (v: Record<string, unknown>, done: () => void) => {
    try {
      await save.mutateAsync(v);
      done();
      toast('Saved');
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Description"
          right={
            canEdit &&
            !editDesc && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDesc(t.description);
                  setEditDesc(true);
                }}
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            )
          }
        />
        <div className="px-5 py-4">
          {editDesc ? (
            <div className="flex flex-col gap-3">
              <Textarea
                aria-label="Description"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={10}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditDesc(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={save.isPending}
                  onClick={() => run({ description: desc }, () => setEditDesc(false))}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : t.description ? (
            <div className="prose-lsa text-[14px]">
              <ReactMarkdown>{t.description}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-[13px] text-faint">No description.</p>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Acceptance criteria"
          right={
            canEdit &&
            !editAc && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAc(t.acceptanceCriteria.map((c) => c.text));
                  setEditAc(true);
                }}
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            )
          }
        />
        <div className="px-5 py-4">
          {editAc ? (
            <div className="flex flex-col gap-2">
              {ac.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-9 shrink-0 font-mono text-[11.5px] text-faint">AC{i + 1}</span>
                  <Input
                    aria-label={`Criterion ${i + 1}`}
                    value={c}
                    onChange={(e) => setAc(ac.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove"
                    onClick={() => setAc(ac.filter((_, j) => j !== i))}
                  >
                    <Trash className="size-3.5" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAc([...ac, ''])}>
                  <Plus className="size-3.5" /> Add
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" onClick={() => setEditAc(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={save.isPending}
                  onClick={() =>
                    run(
                      {
                        acceptanceCriteria: ac
                          .map((x) => x.trim())
                          .filter(Boolean)
                          .map((text, i) => ({ id: `AC${i + 1}`, text })),
                      },
                      () => setEditAc(false),
                    )
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          ) : t.acceptanceCriteria.length ? (
            <ol className="flex flex-col">
              {t.acceptanceCriteria.map((c) => (
                <li key={c.id} className="flex gap-3 border-b border-line py-2.5 text-[14px] last:border-0">
                  <span className="w-9 shrink-0 pt-0.5 font-mono text-[11.5px] text-faint">{c.id}</span>
                  {c.text}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-faint">
              None yet. The Requirement Analyst drafts them during triage, and writes full Given/When/Then
              criteria when a run starts.
            </p>
          )}
        </div>
      </Card>
      {t.children.length > 0 && (
        <Card>
          <CardHeader title="Defects found and tracked during runs" />
          <div className="p-2">
            {t.children.map((c) => (
              <Link
                key={c.id}
                href={`/tickets/${c.key}`}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.03]"
              >
                <TypeBadge type={c.type} withLabel={false} />
                <span className="w-[72px] font-mono text-[11.5px] text-faint">{c.key}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{c.title}</span>
                <StatusPill status={c.status} />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Timeline({ ticketKey }: { ticketKey: string }) {
  const q = useTimeline(ticketKey);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <Card className="p-2">
      <ActivityFeed items={q.data ?? []} />
    </Card>
  );
}

function Comments({ t }: { t: TicketDto }) {
  const toast = useToast();
  const q = useComments(t.key);
  const [body, setBody] = useState('');
  const add = useAction(
    (b: string) => post(`/tickets/${t.key}/comments`, { body: b }),
    [keys.comments(t.key), keys.ticket(t.key), keys.timeline(t.key)],
  );
  const mentions = useMemo(() => Object.values(AGENTS).map((a) => `@${a.shortName.replace(/\s+/g, '')}`), []);
  return (
    <div className="flex flex-col gap-3">
      <Card className="p-2">
        {q.isLoading ? (
          <Loading />
        ) : (q.data ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-faint">
            No comments yet. Ask any agent a question with @, for example “@QA which tests cover the report?”.
          </p>
        ) : (
          <ul className="flex flex-col">
            {(q.data ?? []).map((c) => (
              <li key={c.id} className="flex gap-3 rounded-xl px-3 py-3">
                {c.authorType === 'agent' && c.agentKey ? (
                  <AgentIcon agent={c.agentKey} tone="accent" size={30} />
                ) : (
                  <Avatar name={c.author?.name ?? '?'} size={30} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="font-semibold">
                      {c.agentKey ? AGENTS[c.agentKey].name : c.author?.name}
                    </span>
                    <span className="text-faint">{ago(c.createdAt)}</span>
                  </div>
                  <div className="prose-lsa mt-1 text-[14px]">
                    <ReactMarkdown>{c.body}</ReactMarkdown>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          try {
            await add.mutateAsync(body.trim());
            setBody('');
          } catch (err) {
            toast(errorText(err), 'bad');
          }
        }}
        className="flex flex-col gap-2"
      >
        <Textarea
          aria-label="Comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment, or ask an agent with @QA, @LegacyIntel, @Architect…"
          rows={3}
        />
        <div className="flex flex-wrap items-center gap-2">
          {mentions.slice(0, 6).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}${m} `)}
              className="rounded-full border border-line-2 px-2.5 py-1 text-[11.5px] text-muted hover:text-text"
            >
              {m}
            </button>
          ))}
          <div className="flex-1" />
          <Button type="submit" variant="primary" loading={add.isPending} disabled={!body.trim()}>
            <Send className="size-4" /> Comment
          </Button>
        </div>
      </form>
    </div>
  );
}

function Runs({ t }: { t: TicketDto }) {
  if (t.runs.length === 0)
    return (
      <Card className="px-5 py-8 text-center text-[13px] text-faint">
        No runs yet. Start one when the ticket is ready.
      </Card>
    );
  return (
    <Card className="p-2">
      {t.runs.map((r) => (
        <Link
          key={r.id}
          href={`/runs/${r.id}`}
          className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/[0.03]"
        >
          <GitBranch className="size-4 text-muted" />
          <span className="text-[13.5px]">{WORKFLOWS[r.workflowType].name}</span>
          <span className="text-[12.5px] text-faint">
            {r.startedBy ? `by ${r.startedBy.name} · ` : ''}
            {dateTime(r.startedAt)}
          </span>
          <span className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[11.5px] text-faint">{money(r.costUsd)}</span>
            <Pill tone={runTone(r.status)} live={r.status === 'running'}>
              {RUN_STATUS_LABELS[r.status]}
            </Pill>
          </span>
          {r.error && <div className="w-full pl-7 text-[12.5px] text-bad">{r.error}</div>}
        </Link>
      ))}
    </Card>
  );
}

function Sidebar({ t }: { t: TicketDto }) {
  const toast = useToast();
  const { canEdit, project } = useCanEdit(t);
  const members = useMembers(project?.id).data ?? [];
  const [labels, setLabels] = useState<string | null>(null);
  const save = useAction(
    (v: Record<string, unknown>) => patch<TicketDto>(`/tickets/${t.key}`, { version: t.version, ...v }),
    [keys.ticket(t.key), keys.timeline(t.key), ['tickets']],
  );
  const set = async (v: Record<string, unknown>) => {
    try {
      await save.mutateAsync(v);
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 py-2">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="min-w-0 text-[13.5px]">{value}</div>
    </div>
  );
  return (
    <aside className="flex flex-col gap-4">
      <Card className="px-5 py-3">
        {row('Status', <span className="text-[13.5px]">{STATUS_LABELS[t.status]}</span>)}
        {row(
          'Type',
          canEdit ? (
            <Select
              aria-label="Type"
              value={t.type}
              onChange={(e) => set({ type: e.target.value })}
              className="h-8 py-0"
            >
              {TICKET_TYPES.map((x) => (
                <option key={x} value={x}>
                  {TYPE_LABELS[x]}
                </option>
              ))}
            </Select>
          ) : (
            TYPE_LABELS[t.type]
          ),
        )}
        {row(
          'Priority',
          canEdit ? (
            <Select
              aria-label="Priority"
              value={t.priority}
              onChange={(e) => set({ priority: e.target.value })}
              className="h-8 py-0"
            >
              {TICKET_PRIORITIES.map((x) => (
                <option key={x} value={x}>
                  {PRIORITY_LABELS[x]}
                </option>
              ))}
            </Select>
          ) : (
            PRIORITY_LABELS[t.priority]
          ),
        )}
        {row(
          'Assignee',
          canEdit ? (
            <Select
              aria-label="Assignee"
              value={t.assignee?.id ?? ''}
              onChange={(e) => set({ assigneeId: e.target.value || null })}
              className="h-8 py-0"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          ) : (
            (t.assignee?.name ?? 'Unassigned')
          ),
        )}
        {row(
          'Labels',
          canEdit && labels !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void set({
                  labels: labels
                    .split(',')
                    .map((l) => l.trim())
                    .filter(Boolean),
                }).then(() => setLabels(null));
              }}
            >
              <Input
                aria-label="Labels"
                autoFocus
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                onBlur={() => setLabels(null)}
                className="h-8"
              />
            </form>
          ) : (
            <button
              disabled={!canEdit}
              onClick={() => setLabels(t.labels.join(', '))}
              className="text-left text-muted enabled:hover:text-text"
            >
              {t.labels.length ? t.labels.join(', ') : canEdit ? 'Add labels' : 'None'}
            </button>
          ),
        )}
        {row(
          'Due',
          canEdit ? (
            <Input
              aria-label="Due date"
              type="date"
              value={t.dueDate ?? ''}
              onChange={(e) => set({ dueDate: e.target.value || null })}
              className="h-8"
            />
          ) : (
            (t.dueDate ?? 'None')
          ),
        )}
        {row(
          'Reporter',
          t.reporter?.name ??
            (t.source === 'agent' ? 'QA agent' : t.source === 'intake_api' ? 'External system' : '—'),
        )}
        {row(
          'Source',
          {
            board: 'Board',
            home: 'Home request',
            intake_api: 'Intake API',
            agent: 'Found by an agent',
            comment: 'Comment',
          }[t.source],
        )}
        {t.externalRef && row('External ref', <span className="font-mono text-[12px]">{t.externalRef}</span>)}
        {t.parent &&
          row(
            'Parent',
            <Link href={`/tickets/${t.parent.key}`} className="text-accent hover:underline">
              {t.parent.key}
            </Link>,
          )}
        {row('Created', dateTime(t.createdAt))}
        {t.closedAt && row('Closed', dateTime(t.closedAt))}
      </Card>
    </aside>
  );
}
