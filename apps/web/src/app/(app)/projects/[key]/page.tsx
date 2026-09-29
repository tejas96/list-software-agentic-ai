'use client';

import { ArrowLeft, Copy, KeyRound, Plus, Trash, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import {
  CREDENTIAL_KINDS,
  PROJECT_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  TICKET_TYPES,
  WORKFLOWS,
  WORKFLOW_TYPES,
  type CredentialKind,
  type ProjectDto,
  type ProjectRole,
  type ProjectSettings,
} from '@lsa/contracts';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  Pill,
  Select,
  Tabs,
  Textarea,
  Toggle,
  errorText,
  useToast,
} from '@/components/ui';
import { ago, TYPE_LABELS } from '@/lib/format';
import { useCan } from '@/lib/project';
import {
  del,
  keys,
  patch,
  post,
  useAction,
  useCredentials,
  useDirectory,
  useMembers,
  useProject,
  useSources,
} from '@/lib/queries';

type Tab = 'general' | 'workflow' | 'members' | 'credentials' | 'intake';

export default function ProjectSettingsPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const q = useProject(key);
  const [tab, setTab] = useState<Tab>('general');
  const canManage = useCan(q.data, 'project.manage');

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data)
    return (
      <div className="p-8">
        <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  const p = q.data;

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-6 px-4 py-6 md:px-8">
      <Link href="/projects" className="flex items-center gap-1.5 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Projects
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-12 place-items-center rounded-xl border border-accent/30 bg-accent/10 font-mono text-[13px] font-semibold text-accent">
          {p.key}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-semibold tracking-tight">{p.name}</h1>
          <div className="text-[13px] text-muted">
            {p.clientName || 'Internal'}
            {p.archived ? ' · Archived' : ''}
          </div>
        </div>
        <Link href={`/board?project=${p.key}`}>
          <Button variant="default">Open board</Button>
        </Link>
      </div>
      {!canManage && (
        <div className="rounded-xl border border-line bg-panel-2 px-4 py-3 text-[13px] text-muted">
          You can view these settings. A project admin can change them.
        </div>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'general', label: 'General' },
          { id: 'workflow', label: 'Workflow' },
          { id: 'members', label: 'People' },
          { id: 'credentials', label: 'Credentials' },
          { id: 'intake', label: 'Intake' },
        ]}
      />
      {tab === 'general' && <GeneralTab p={p} canManage={canManage} />}
      {tab === 'workflow' && <WorkflowTab p={p} canManage={canManage} />}
      {tab === 'members' && <MembersTab p={p} />}
      {tab === 'credentials' && <CredentialsTab p={p} canManage={canManage} />}
      {tab === 'intake' && <IntakeTab p={p} canManage={canManage} />}
    </div>
  );
}

function useSaveProject(p: ProjectDto) {
  return useAction(
    (body: unknown) => patch<ProjectDto>(`/projects/${p.id}`, body),
    [keys.project(p.key), keys.projects],
  );
}

function GeneralTab({ p, canManage }: { p: ProjectDto; canManage: boolean }) {
  const toast = useToast();
  const save = useSaveProject(p);
  const [name, setName] = useState(p.name);
  const [clientName, setClientName] = useState(p.clientName);
  const [description, setDescription] = useState(p.description);
  const [stack, setStack] = useState(p.techStack.join(', '));
  const [archiving, setArchiving] = useState(false);
  const run = async (body: unknown, msg: string) => {
    try {
      await save.mutateAsync(body);
      toast(msg);
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5">
        <Field label="Name">
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
          )}
        </Field>
        <Field label="Client">
          {(id) => (
            <Input
              id={id}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              disabled={!canManage}
            />
          )}
        </Field>
        <Field label="Description" hint="What the system does. Agents read this for context on every run.">
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canManage}
            />
          )}
        </Field>
        <Field label="Technology" hint="Comma separated">
          {(id) => (
            <Input id={id} value={stack} onChange={(e) => setStack(e.target.value)} disabled={!canManage} />
          )}
        </Field>
        {canManage && (
          <div className="flex justify-end">
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={name.trim().length < 2}
              onClick={() =>
                run(
                  {
                    name: name.trim(),
                    clientName: clientName.trim(),
                    description: description.trim(),
                    techStack: stack
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                  'Project saved',
                )
              }
            >
              Save changes
            </Button>
          </div>
        )}
      </Card>
      {canManage && (
        <Card className="flex flex-wrap items-center gap-4 border-bad/25 p-5">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">
              {p.archived ? 'Restore project' : 'Archive project'}
            </div>
            <div className="text-[12.5px] text-muted">
              {p.archived
                ? 'Bring the project back to everyone’s project list.'
                : 'Hides the project from lists. Tickets, runs and the audit trail are kept.'}
            </div>
          </div>
          {p.archived ? (
            <Button variant="default" onClick={() => run({ archived: false }, 'Project restored')}>
              Restore
            </Button>
          ) : archiving ? (
            <Button variant="danger" onClick={() => run({ archived: true }, 'Project archived')}>
              Confirm archive
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setArchiving(true)}>
              Archive
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

function WorkflowTab({ p, canManage }: { p: ProjectDto; canManage: boolean }) {
  const toast = useToast();
  const save = useSaveProject(p);
  const sources = useSources(p.id).data ?? [];
  const creds = useCredentials(p.id, canManage).data ?? [];
  const [s, setS] = useState<ProjectSettings>(p.settings);
  const [commands, setCommands] = useState(p.settings.allowedCommands.join(', '));
  useEffect(() => {
    setS(p.settings);
    setCommands(p.settings.allowedCommands.join(', '));
  }, [p.settings]);
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) =>
    setS((cur) => ({ ...cur, [k]: v }));
  const dirty =
    JSON.stringify({ ...s, allowedCommands: commands }) !==
    JSON.stringify({ ...p.settings, allowedCommands: p.settings.allowedCommands.join(', ') });

  const submit = async () => {
    try {
      await save.mutateAsync({
        settings: {
          ...s,
          allowedCommands: commands
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
        },
      });
      toast('Workflow settings saved');
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };
  const gitSources = sources.filter((x) => x.kind === 'git');
  const oracleCreds = creds.filter((c) => c.kind === 'oracle_db');
  const disabled = !canManage;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Intake and start" />
        <div className="flex flex-col gap-4 p-5">
          <Toggle
            checked={s.autoTriage}
            onChange={(v) => !disabled && set('autoTriage', v)}
            label="Triage every new ticket"
            description="Classify it, draft acceptance criteria, and check for duplicates as soon as it is logged."
          />
          <Toggle
            checked={s.autoStartOnReady}
            onChange={(v) => !disabled && set('autoStartOnReady', v)}
            label="Start a run when a ticket moves to Ready"
            description="Otherwise someone starts it from the ticket."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TICKET_TYPES.map((t) => (
              <Field key={t} label={`${TYPE_LABELS[t]} tickets use`}>
                {(id) => (
                  <Select
                    id={id}
                    value={s.workflowByType[t]}
                    disabled={disabled}
                    onChange={(e) =>
                      set('workflowByType', {
                        ...s.workflowByType,
                        [t]: e.target.value as (typeof WORKFLOW_TYPES)[number],
                      })
                    }
                  >
                    {WORKFLOW_TYPES.map((w) => (
                      <option key={w} value={w}>
                        {WORKFLOWS[w].name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Approvals and limits" />
        <div className="flex flex-col gap-4 p-5">
          <Toggle
            checked={s.gates.plan}
            onChange={(v) => !disabled && set('gates', { ...s.gates, plan: v })}
            label="Approve the plan before building"
            description="Recommended. Without it, agents build straight after analysis."
          />
          <Toggle
            checked={s.gates.release}
            onChange={(v) => !disabled && set('gates', { ...s.gates, release: v })}
            label="Approve the release before publishing the branch"
          />
          <Toggle
            checked={s.requireIndependentApprover}
            onChange={(v) => !disabled && set('requireIndependentApprover', v)}
            label="Require an independent approver"
            description="The person who requested a change cannot approve it (four-eyes rule)."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Test-fix cycles" hint="Before asking a person">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={10}
                  value={s.qaMaxAttempts}
                  disabled={disabled}
                  onChange={(e) => set('qaMaxAttempts', clamp(e.target.valueAsNumber, 1, 10))}
                />
              )}
            </Field>
            <Field label="Plan revisions" hint="Before the run is blocked">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={10}
                  value={s.maxPlanRevisions}
                  disabled={disabled}
                  onChange={(e) => set('maxPlanRevisions', clamp(e.target.valueAsNumber, 0, 10))}
                />
              )}
            </Field>
            <Field label="Budget per run (USD)" hint="The run stops for a person when reached">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={1000}
                  value={s.runBudgetUsd}
                  disabled={disabled}
                  onChange={(e) => set('runBudgetUsd', clamp(e.target.valueAsNumber, 1, 1000))}
                />
              )}
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Sandbox" />
        <div className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Working repository"
              hint="Agents branch from here. Connect it on the Knowledge page."
            >
              {(id) => (
                <Select
                  id={id}
                  value={s.workSourceId ?? ''}
                  disabled={disabled}
                  onChange={(e) => set('workSourceId', e.target.value || null)}
                >
                  <option value="">
                    {gitSources.length ? 'First Git source' : 'No Git source connected'}
                  </option>
                  {gitSources.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Base branch">
              {(id) => (
                <Input
                  id={id}
                  value={s.baseBranch}
                  disabled={disabled}
                  onChange={(e) => set('baseBranch', e.target.value)}
                />
              )}
            </Field>
            <Field label="Test command" hint="Run by QA, e.g. pnpm test or utplsql run">
              {(id) => (
                <Input
                  id={id}
                  value={s.testCommand ?? ''}
                  disabled={disabled}
                  onChange={(e) => set('testCommand', e.target.value || null)}
                  className="font-mono"
                />
              )}
            </Field>
            <Field label="Build command" hint="Compile or build check, optional">
              {(id) => (
                <Input
                  id={id}
                  value={s.buildCommand ?? ''}
                  disabled={disabled}
                  onChange={(e) => set('buildCommand', e.target.value || null)}
                  className="font-mono"
                />
              )}
            </Field>
          </div>
          <Field
            label="Allowed commands"
            hint="Executables agents may run in the sandbox, comma separated. No shell is used."
          >
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={commands}
                disabled={disabled}
                onChange={(e) => setCommands(e.target.value)}
                className="font-mono text-[12.5px]"
              />
            )}
          </Field>
          <div className="rounded-xl border border-wait/30 bg-wait/5 p-4">
            <Toggle
              checked={!!s.sandboxDb}
              onChange={(v) =>
                !disabled &&
                set('sandboxDb', v ? { connectString: '', credentialId: oracleCreds[0]?.id ?? '' } : null)
              }
              label="Oracle sandbox schema"
              description="Agents compile and test PL/SQL here. Never point this at production."
            />
            {s.sandboxDb && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Connect string">
                  {(id) => (
                    <Input
                      id={id}
                      value={s.sandboxDb!.connectString}
                      disabled={disabled}
                      placeholder="db-dev.internal:1521/COREDEV"
                      onChange={(e) => set('sandboxDb', { ...s.sandboxDb!, connectString: e.target.value })}
                    />
                  )}
                </Field>
                <Field
                  label="Credential"
                  hint={
                    oracleCreds.length ? undefined : 'Add an Oracle credential on the Credentials tab first'
                  }
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={s.sandboxDb!.credentialId}
                      disabled={disabled}
                      onChange={(e) => set('sandboxDb', { ...s.sandboxDb!, credentialId: e.target.value })}
                    >
                      <option value="">Choose</option>
                      {oracleCreds.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
          </div>
        </div>
      </Card>

      {canManage && (
        <div className="sticky bottom-4 flex justify-end gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setS(p.settings);
                setCommands(p.settings.allowedCommands.join(', '));
              }}
            >
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            onClick={submit}
            loading={save.isPending}
            disabled={
              !dirty || (!!s.sandboxDb && (s.sandboxDb.connectString.length < 3 || !s.sandboxDb.credentialId))
            }
          >
            Save workflow settings
          </Button>
        </div>
      )}
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;

function MembersTab({ p }: { p: ProjectDto }) {
  const toast = useToast();
  const canManage = useCan(p, 'members.manage');
  const members = useMembers(p.id);
  const directory = useDirectory();
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectRole>('requester');
  const inv = [keys.members(p.id), keys.project(p.key)];
  const add = useAction(
    (b: { userId: string; role: ProjectRole }) => post(`/projects/${p.id}/members`, b),
    inv,
  );
  const update = useAction(
    (b: { userId: string; role: ProjectRole }) =>
      patch(`/projects/${p.id}/members/${b.userId}`, { role: b.role }),
    inv,
  );
  const remove = useAction((uid: string) => del(`/projects/${p.id}/members/${uid}`), inv);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };
  const memberIds = new Set((members.data ?? []).map((m) => m.userId));
  const candidates = (directory.data ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title={`People · ${members.data?.length ?? 0}`}
          right={
            canManage && (
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                <UserPlus className="size-3.5" /> Add person
              </Button>
            )
          }
        />
        {members.isLoading ? (
          <Loading />
        ) : members.error ? (
          <ErrorBox error={members.error} />
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {(members.data ?? []).length === 0 && (
              <p className="px-5 py-4 text-[13px] text-faint">
                No members yet. Workspace admins can always access every project.
              </p>
            )}
            {(members.data ?? []).map((m) => (
              <div key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Avatar name={m.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium">{m.name}</div>
                  <div className="truncate text-[12px] text-faint">
                    {m.email} · added {ago(m.addedAt)}
                  </div>
                </div>
                {canManage ? (
                  <>
                    <Select
                      aria-label={`Role of ${m.name}`}
                      value={m.role}
                      className="h-8 w-auto py-0 text-[12.5px]"
                      onChange={(e) =>
                        act(
                          () => update.mutateAsync({ userId: m.userId, role: e.target.value as ProjectRole }),
                          'Role updated',
                        )
                      }
                    >
                      {PROJECT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => act(() => remove.mutateAsync(m.userId), `${m.name} removed`)}
                    >
                      <Trash className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <Pill>{ROLE_LABELS[m.role]}</Pill>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-5">
        <div className="eyebrow">What each role can do</div>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PROJECT_ROLES.map((r) => (
            <div key={r}>
              <dt className="text-[13px] font-medium">{ROLE_LABELS[r]}</dt>
              <dd className="text-[12.5px] text-muted">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a person"
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!userId}
              loading={add.isPending}
              onClick={() =>
                act(async () => {
                  await add.mutateAsync({ userId, role });
                  setAdding(false);
                  setUserId('');
                }, 'Person added')
              }
            >
              Add
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label="Person"
            hint={
              candidates.length
                ? undefined
                : 'Everyone is already a member. A workspace admin can create new users.'
            }
          >
            {(id) => (
              <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}>
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
                {PROJECT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}

const CRED_LABEL: Record<CredentialKind, string> = {
  git_token: 'Git token',
  oracle_db: 'Oracle database',
  api_key: 'API key',
};

function CredentialsTab({ p, canManage }: { p: ProjectDto; canManage: boolean }) {
  const toast = useToast();
  const creds = useCredentials(p.id, canManage);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CredentialKind>('git_token');
  const [secret, setSecret] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const create = useAction(
    (b: unknown) => post(`/projects/${p.id}/credentials`, b),
    [keys.credentials(p.id)],
  );
  const remove = useAction((id: string) => del(`/credentials/${id}`), [keys.credentials(p.id)]);
  if (!canManage)
    return (
      <Card className="p-5 text-[13px] text-muted">Only project admins can see and manage credentials.</Card>
    );

  const valid = name.trim().length >= 2 && (kind === 'oracle_db' ? user && password : secret);
  const submit = async () => {
    try {
      await create.mutateAsync({
        name: name.trim(),
        kind,
        secret: kind === 'oracle_db' ? JSON.stringify({ user, password }) : secret,
      });
      toast('Credential stored');
      setAdding(false);
      setName('');
      setSecret('');
      setUser('');
      setPassword('');
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };
  return (
    <Card>
      <CardHeader
        title="Credentials"
        right={
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add
          </Button>
        }
      />
      <p className="px-5 pt-4 text-[12.5px] text-muted">
        Encrypted with AES-256-GCM before they reach the database and never shown again. Agents never see
        them; only the worker uses them to connect.
      </p>
      {creds.isLoading ? (
        <Loading />
      ) : (
        <div className="flex flex-col divide-y divide-line p-2">
          {(creds.data ?? []).length === 0 && (
            <p className="px-3 py-4 text-[13px] text-faint">No credentials stored.</p>
          )}
          {(creds.data ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-3">
              <KeyRound className="size-4 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{c.name}</div>
                <div className="text-[12px] text-faint">
                  {CRED_LABEL[c.kind as CredentialKind] ?? c.kind} · added {ago(c.createdAt)} ·{' '}
                  {c.lastUsedAt ? `used ${ago(c.lastUsedAt)}` : 'not used yet'}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${c.name}`}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(c.id);
                    toast('Credential deleted');
                  } catch (err) {
                    toast(errorText(err), 'bad');
                  }
                }}
              >
                <Trash className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Store a credential"
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!valid} loading={create.isPending} onClick={submit}>
              Store encrypted
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Kind">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as CredentialKind)}>
                {CREDENTIAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CRED_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {kind === 'oracle_db' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="User">
                {(id) => (
                  <Input id={id} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
                )}
              </Field>
              <Field label="Password">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                )}
              </Field>
            </div>
          ) : (
            <Field
              label={kind === 'git_token' ? 'Token' : 'Key'}
              hint={
                kind === 'git_token'
                  ? 'A token with read access (and push access if agents should publish branches).'
                  : undefined
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="new-password"
                />
              )}
            </Field>
          )}
        </div>
      </Modal>
    </Card>
  );
}

function IntakeTab({ p, canManage }: { p: ProjectDto; canManage: boolean }) {
  const toast = useToast();
  const [issued, setIssued] = useState<{ token: string; endpoint: string } | null>(null);
  const rotate = useAction(
    () => post<{ token: string; endpoint: string }>(`/projects/${p.id}/intake-token`),
    [],
  );
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const endpoint = `${origin}/api/v1/intake/${p.key}`;
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast('Copied'));
  };
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <div className="text-[14px] font-semibold">Log requirements from other systems</div>
          <p className="mt-1 text-[13px] text-muted">
            Your ticketing tool, email bridge or a script can POST a requirement to this endpoint. It is
            logged on the board as a ticket, triaged, and tracked like any other.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">POST {endpoint}</code>
          <Button size="sm" variant="ghost" onClick={() => copy(endpoint)} aria-label="Copy endpoint">
            <Copy className="size-3.5" />
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-xl bg-panel-2 p-3 font-mono text-[11.5px] leading-relaxed text-muted">{`curl -X POST ${endpoint} \\
  -H "Authorization: Bearer <intake token>" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Describe the requirement", "externalRef": "SR-1234", "reporterEmail": "someone@example.com"}'`}</pre>
        <p className="text-[12.5px] text-faint">
          Optional fields: title, type (feature, bug, hotfix, analysis, task), priority (low, medium, high,
          critical). A repeated externalRef returns the existing ticket instead of a duplicate.
        </p>
      </Card>
      {canManage && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Intake token</div>
              <div className="text-[12.5px] text-muted">
                Issuing a new token immediately revokes the previous one.
              </div>
            </div>
            <Button
              variant="default"
              loading={rotate.isPending}
              onClick={async () => {
                try {
                  setIssued(await rotate.mutateAsync(undefined));
                } catch (err) {
                  toast(errorText(err), 'bad');
                }
              }}
            >
              <KeyRound className="size-4" /> Issue new token
            </Button>
          </div>
          {issued && (
            <div className="rounded-xl border border-wait/35 bg-wait/5 p-4">
              <div className="text-[12.5px] text-wait">
                Copy it now. It is stored only as a hash and cannot be shown again.
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{issued.token}</code>
                <Button size="sm" variant="ghost" onClick={() => copy(issued.token)} aria-label="Copy token">
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
