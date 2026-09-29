'use client';

import { useQuery } from '@tanstack/react-query';
import { Boxes, Plus, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABELS, type ProjectDto } from '@lsa/contracts';
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  Pill,
  Textarea,
  errorText,
  useToast,
} from '@/components/ui';
import { get, keys, post, useAction, useMe, useProjects } from '@/lib/queries';

export default function ProjectsPage() {
  const me = useMe().data;
  const active = useProjects();
  const [showArchived, setShowArchived] = useState(false);
  const all = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => get<ProjectDto[]>('/projects/all'),
    enabled: !!me?.isAdmin && showArchived,
  });
  const [creating, setCreating] = useState(false);
  const list = showArchived ? all : active;

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Projects</div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Client systems</h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">
            One project per system you maintain. Each has its own board, people, knowledge sources,
            credentials and workflow settings.
          </p>
        </div>
        {me?.isAdmin && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : 'Show archived'}
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New project
            </Button>
          </div>
        )}
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Boxes className="size-5" />}
            title="No projects yet"
            body={
              me?.isAdmin
                ? 'Create the first project to start logging requirements.'
                : 'Ask a workspace administrator to add you to a project.'
            }
            action={
              me?.isAdmin ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create a project
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(list.data ?? []).map((p) => (
            <Card
              key={p.id}
              className={cx(
                'group flex flex-col gap-4 p-5 transition hover:border-accent/35',
                p.archived && 'opacity-60',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="grid size-11 place-items-center rounded-xl border border-accent/30 bg-accent/10 font-mono text-[12px] font-semibold text-accent">
                  {p.key}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{p.name}</div>
                  <div className="truncate text-[12.5px] text-muted">{p.clientName || 'Internal'}</div>
                </div>
                {p.archived ? (
                  <Pill>Archived</Pill>
                ) : (
                  p.myRole && <Pill tone="accent">{ROLE_LABELS[p.myRole]}</Pill>
                )}
              </div>
              {p.description && <p className="line-clamp-2 text-[13px] text-muted">{p.description}</p>}
              {p.techStack.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {p.techStack.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-muted"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-4 gap-2 border-t border-line pt-4 text-center">
                <Stat label="Open" value={p.counts.open} />
                <Stat
                  label="Running"
                  value={p.counts.activeRuns}
                  tone={p.counts.activeRuns ? 'text-run' : undefined}
                />
                <Stat
                  label="Approval"
                  value={p.counts.needsApproval}
                  tone={p.counts.needsApproval ? 'text-wait' : undefined}
                />
                <Stat
                  label="Blocked"
                  value={p.counts.blocked}
                  tone={p.counts.blocked ? 'text-bad' : undefined}
                />
              </div>
              <div className="flex gap-2">
                <Link href={`/board?project=${p.key}`} className="flex-1">
                  <Button variant="default" className="w-full">
                    Open board
                  </Button>
                </Link>
                <Link href={`/projects/${p.key}`}>
                  <Button variant="ghost" aria-label={`${p.name} settings`}>
                    <Settings2 className="size-4" />
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
      <CreateProjectModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className={cx('text-[18px] font-semibold tabular-nums', tone)}>{value}</div>
      <div className="text-[11px] text-faint">{label}</div>
    </div>
  );
}

function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [description, setDescription] = useState('');
  const [stack, setStack] = useState('');
  const create = useAction((body: unknown) => post<ProjectDto>('/projects', body), [keys.projects, keys.me]);
  const keyOk = /^[A-Z][A-Z0-9]{1,9}$/.test(key);
  const submit = async () => {
    try {
      const p = await create.mutateAsync({
        key,
        name: name.trim(),
        clientName: clientName.trim(),
        description: description.trim(),
        techStack: stack
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast(`Project ${p.key} created`);
      onClose();
      router.push(`/projects/${p.key}`);
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={create.isPending}
            disabled={!keyOk || name.trim().length < 2}
          >
            Create project
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_1fr]">
        <Field
          label="Key"
          hint="Prefix for ticket numbers"
          error={key && !keyOk ? '2–10 capitals or digits' : null}
        >
          {(id) => (
            <Input
              id={id}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={10}
              className="font-mono"
            />
          )}
        </Field>
        <Field label="Name">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Client">
          {(id) => <Input id={id} value={clientName} onChange={(e) => setClientName(e.target.value)} />}
        </Field>
        <Field label="Description" hint="What the system does. Agents read this for context.">
          {(id) => (
            <Textarea id={id} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          )}
        </Field>
        <Field label="Technology" hint="Comma separated, e.g. Oracle Forms 12c, Oracle Reports, PL/SQL">
          {(id) => <Input id={id} value={stack} onChange={(e) => setStack(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}
