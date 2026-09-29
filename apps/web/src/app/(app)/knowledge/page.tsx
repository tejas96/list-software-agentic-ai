'use client';

import { Database, GitBranch, Network, Plus, RefreshCw, Search, Sparkles, Trash } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { AskAnswerDto, CodeObjectDto, ObjectGraphDto, SearchHitDto, SourceDto } from '@lsa/contracts';
import {
  Button,
  Card,
  CardHeader,
  cx,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  Pill,
  Select,
  Sheet,
  Textarea,
  errorText,
  useToast,
} from '@/components/ui';
import { ago } from '@/lib/format';
import { useCan, useCurrentProject } from '@/lib/project';
import {
  askKnowledge,
  del,
  keys,
  knowledgeObject,
  objectGraph,
  post,
  searchKnowledge,
  useAction,
  useCredentials,
  useSources,
} from '@/lib/queries';
import { useRoom } from '@/lib/realtime';

const KIND_LABEL: Record<string, string> = {
  oracle_form: 'Form',
  oracle_report: 'Report',
  plsql_package: 'Package',
  plsql_procedure: 'Procedure',
  plsql_function: 'Function',
  plsql_trigger: 'Trigger',
  db_table: 'Table',
  db_view: 'View',
  db_sequence: 'Sequence',
  form_block: 'Block',
  file: 'File',
  class: 'Class',
  function: 'Function',
  module: 'Module',
};

export default function KnowledgePage() {
  const { project, projects, setProject } = useCurrentProject();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [hits, setHits] = useState<SearchHitDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskAnswerDto | null>(null);
  const [asking, setAsking] = useState(false);
  const [openObj, setOpenObj] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useRoom(project ? `project:${project.id}` : null);
  const sources = useSources(project?.id);
  const isAdmin = useCan(project, 'knowledge.manage');

  if (!project) return <EmptyState icon={<Network className="size-5" />} title="No project selected" />;

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      setHits(await searchKnowledge(project.id, q.trim(), kind || undefined));
    } catch (err) {
      toast(errorText(err), 'bad');
    } finally {
      setSearching(false);
    }
  };
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim().length < 3) return;
    setAsking(true);
    setAnswer(null);
    try {
      setAnswer(await askKnowledge(project.id, question.trim()));
    } catch (err) {
      toast(errorText(err), 'bad');
    } finally {
      setAsking(false);
    }
  };

  const total = (sources.data ?? []).reduce((n, s) => n + s.stats.objects, 0);

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Knowledge</div>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight">
              What the agents know about {project.name}
            </h1>
            <Select
              aria-label="Project"
              value={project.key}
              onChange={(e) => setProject(e.target.value)}
              className="h-8 w-auto py-0 text-[12.5px]"
            >
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key}
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-1.5 max-w-3xl text-[14px] text-muted">
            Forms, reports, PL/SQL, tables and code from your connected sources, with every dependency between
            them. Agents search this before changing anything; you can too.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-5">
          <Card>
            <form onSubmit={search} className="flex flex-wrap gap-2 p-4">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <Input
                  aria-label="Search the knowledge graph"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Object name or words from code, e.g. CUSTOMER or address validation"
                  className="pl-9"
                />
              </div>
              <Select
                aria-label="Kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-auto"
              >
                <option value="">All kinds</option>
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="primary" loading={searching}>
                Search
              </Button>
            </form>
            {hits && (
              <div className="border-t border-line p-2">
                {hits.length === 0 && (
                  <p className="px-3 py-6 text-center text-[13px] text-faint">
                    No matches.{' '}
                    {total === 0 ? 'Connect and sync a source first.' : 'Try another name or fewer words.'}
                  </p>
                )}
                {hits.map((h) => (
                  <button
                    key={h.object.id}
                    onClick={() => setOpenObj(h.object.id)}
                    className="flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.03]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="rounded-md bg-accent/12 px-1.5 py-0.5 font-mono text-[10.5px] text-accent uppercase">
                        {KIND_LABEL[h.object.kind] ?? h.object.kind}
                      </span>
                      <span className="font-mono text-[13px]">{h.object.name}</span>
                      {h.object.path && (
                        <span className="truncate text-[11.5px] text-faint">{h.object.path}</span>
                      )}
                    </span>
                    <span
                      className="line-clamp-2 text-[12.5px] text-muted"
                      dangerouslySetInnerHTML={{ __html: sanitizeHeadline(h.snippet) }}
                    />
                  </button>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Ask the codebase" right={<Pill tone="accent">Legacy Intelligence</Pill>} />
            <form onSubmit={ask} className="flex flex-col gap-3 p-4">
              <Textarea
                aria-label="Question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                placeholder="e.g. Which forms and reports read the CUSTOMER table? What validates the address?"
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  loading={asking}
                  disabled={question.trim().length < 3}
                >
                  <Sparkles className="size-4" /> Ask
                </Button>
              </div>
              {answer && (
                <div className="rounded-xl border border-line bg-panel-2 p-4">
                  <div className="prose-lsa text-[14px]">
                    <ReactMarkdown>{answer.answer}</ReactMarkdown>
                  </div>
                  {answer.citations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {answer.citations.map((c) => (
                        <button
                          key={c.objectId}
                          type="button"
                          onClick={() => setOpenObj(c.objectId)}
                          className="rounded-full border border-line-2 px-2.5 py-1 font-mono text-[11.5px] text-accent hover:border-accent/40"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </form>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Sources"
            right={
              isAdmin && (
                <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                  <Plus className="size-3.5" /> Connect
                </Button>
              )
            }
          />
          <div className="flex flex-col gap-2 p-3">
            {sources.isLoading && <Loading />}
            {(sources.data ?? []).length === 0 && !sources.isLoading && (
              <p className="px-2 py-5 text-center text-[13px] text-faint">
                {isAdmin
                  ? 'Connect a Git repository or an Oracle schema to build the knowledge graph.'
                  : 'No sources connected yet. A project admin can connect them.'}
              </p>
            )}
            {(sources.data ?? []).map((s) => (
              <SourceRow key={s.id} s={s} canManage={isAdmin} projectId={project.id} />
            ))}
          </div>
        </Card>
      </div>
      <ObjectSheet id={openObj} onClose={() => setOpenObj(null)} onOpen={setOpenObj} />
      <AddSourceModal open={adding} onClose={() => setAdding(false)} projectId={project.id} />
    </div>
  );
}

/** Postgres ts_headline wraps matches in <b>; allow only that tag. */
function sanitizeHeadline(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;b&gt;/g, '<b class="text-text">').replace(/&lt;\/b&gt;/g, '</b>');
}

function SourceRow({ s, canManage, projectId }: { s: SourceDto; canManage: boolean; projectId: string }) {
  const toast = useToast();
  const sync = useAction(() => post<{ status: string }>(`/sources/${s.id}/sync`), [keys.sources(projectId)]);
  const remove = useAction(() => del(`/sources/${s.id}`), [keys.sources(projectId)]);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-panel-2 p-3.5">
      <div className="flex items-center gap-2.5">
        {s.kind === 'git' ? (
          <GitBranch className="size-4 text-muted" />
        ) : (
          <Database className="size-4 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{s.name}</span>
        <Pill
          tone={
            s.status === 'ready'
              ? 'ok'
              : s.status === 'syncing'
                ? 'run'
                : s.status === 'error'
                  ? 'bad'
                  : 'idle'
          }
          live={s.status === 'syncing'}
        >
          {s.status}
        </Pill>
      </div>
      <div className="mt-1.5 truncate font-mono text-[11px] text-faint">
        {String(s.config.url ?? s.config.connectString ?? '')}
      </div>
      <div className="mt-2 flex gap-3 text-[12px] text-muted">
        <span>{s.stats.objects} objects</span>
        <span>{s.stats.edges} dependencies</span>
        <span>{s.lastSyncedAt ? `synced ${ago(s.lastSyncedAt)}` : 'never synced'}</span>
      </div>
      {s.lastError && (
        <div className={cx('mt-2 text-[12px]', s.status === 'error' ? 'text-bad' : 'text-wait')}>
          {s.lastError}
        </div>
      )}
      {canManage && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            loading={sync.isPending}
            disabled={s.status === 'syncing'}
            onClick={async () => {
              try {
                const r = await sync.mutateAsync(undefined);
                toast(r.status === 'already_running' ? 'A sync is already running' : 'Sync started');
              } catch (err) {
                toast(errorText(err), 'bad');
              }
            }}
          >
            <RefreshCw className="size-3.5" /> Sync now
          </Button>
          {confirm ? (
            <Button
              size="sm"
              variant="danger"
              loading={remove.isPending}
              onClick={async () => {
                try {
                  await remove.mutateAsync(undefined);
                  toast('Source removed');
                } catch (err) {
                  toast(errorText(err), 'bad');
                }
              }}
            >
              Remove source and its graph
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label="Remove source">
              <Trash className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function AddSourceModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const toast = useToast();
  const creds = useCredentials(projectId, open).data ?? [];
  const [kind, setKind] = useState<'git' | 'oracle_metadata'>('git');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [connect, setConnect] = useState('');
  const [schemas, setSchemas] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const create = useAction(
    (body: unknown) => post(`/projects/${projectId}/sources`, body),
    [keys.sources(projectId)],
  );
  const submit = async () => {
    try {
      await create.mutateAsync(
        kind === 'git'
          ? { kind, name, url, branch, credentialId: credentialId || null }
          : {
              kind,
              name,
              connectString: connect,
              schemas: schemas
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
              credentialId,
            },
      );
      toast('Source connected. The first sync has started.');
      onClose();
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect a knowledge source"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            onClick={submit}
            disabled={
              name.length < 2 || (kind === 'git' ? url.length < 4 : !connect || !schemas || !credentialId)
            }
          >
            Connect and sync
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {(['git', 'oracle_metadata'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cx(
                'rounded-xl border p-3 text-left text-[13px] transition',
                kind === k ? 'border-accent/50 bg-accent/8' : 'border-line-2 hover:border-white/25',
              )}
            >
              <div className="font-semibold">{k === 'git' ? 'Git repository' : 'Oracle schema'}</div>
              <div className="mt-0.5 text-[12px] text-muted">
                {k === 'git'
                  ? 'Forms/Reports XML, PL/SQL, code. Also the repository agents work in.'
                  : 'Objects, source and dependencies from the data dictionary (read-only).'}
              </div>
            </button>
          ))}
        </div>
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'git' ? 'Core banking repository' : 'Core banking schema (UAT)'}
            />
          )}
        </Field>
        {kind === 'git' ? (
          <>
            <Field
              label="Repository URL"
              hint="https:// or git@ URL. Private repositories need a Git token credential."
            >
              {(id) => (
                <Input
                  id={id}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/your-org/core-banking.git"
                />
              )}
            </Field>
            <Field label="Branch">
              {(id) => <Input id={id} value={branch} onChange={(e) => setBranch(e.target.value)} />}
            </Field>
          </>
        ) : (
          <>
            <Field label="Connect string" hint="host:port/service_name of a read-only account">
              {(id) => (
                <Input
                  id={id}
                  value={connect}
                  onChange={(e) => setConnect(e.target.value)}
                  placeholder="db-uat.internal:1521/COREBANK"
                />
              )}
            </Field>
            <Field label="Schemas" hint="Comma separated">
              {(id) => (
                <Input
                  id={id}
                  value={schemas}
                  onChange={(e) => setSchemas(e.target.value)}
                  placeholder="APP, APP_REPORTS"
                />
              )}
            </Field>
          </>
        )}
        <Field label="Credential" hint="Stored encrypted in project settings. Create one there first.">
          {(id) => (
            <Select id={id} value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
              <option value="">{kind === 'git' ? 'None (public repository)' : 'Choose a credential'}</option>
              {creds
                .filter((c) => (kind === 'git' ? c.kind === 'git_token' : c.kind === 'oracle_db'))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

function ObjectSheet({
  id,
  onClose,
  onOpen,
}: {
  id: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<{
    obj: CodeObjectDto & { content: string };
    graph: ObjectGraphDto;
  } | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (id && id !== loadedId) {
    setLoadedId(id);
    setData(null);
    void Promise.all([knowledgeObject(id), objectGraph(id, 1)]).then(([obj, graph]) =>
      setData({ obj, graph }),
    );
  }
  const names = new Map((data?.graph.nodes ?? []).map((n) => [n.id, n]));
  const out = (data?.graph.edges ?? []).filter((e) => e.from === id);
  const inc = (data?.graph.edges ?? []).filter((e) => e.to === id);
  return (
    <Sheet open={!!id} onClose={onClose} width={560}>
      {!data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          <div className="pr-10">
            <span className="rounded-md bg-accent/12 px-1.5 py-0.5 font-mono text-[10.5px] text-accent uppercase">
              {KIND_LABEL[data.obj.kind] ?? data.obj.kind}
            </span>
            <h2 className="mt-2 font-mono text-[18px] font-semibold break-all">{data.obj.name}</h2>
            {data.obj.path && <div className="mt-1 font-mono text-[12px] text-faint">{data.obj.path}</div>}
          </div>
          {data.obj.summary && <p className="text-[13.5px] leading-relaxed text-muted">{data.obj.summary}</p>}
          <MiniGraph
            root={data.graph.root}
            nodes={data.graph.nodes}
            edges={data.graph.edges}
            onOpen={onOpen}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EdgeList
              title="Uses"
              items={out.map((e) => ({ kind: e.kind, node: names.get(e.to) }))}
              onOpen={onOpen}
            />
            <EdgeList
              title="Used by"
              items={inc.map((e) => ({ kind: e.kind, node: names.get(e.from) }))}
              onOpen={onOpen}
            />
          </div>
          {data.obj.content && (
            <div className="flex flex-col gap-2">
              <div className="eyebrow">Source</div>
              <pre className="max-h-[420px] overflow-auto rounded-xl bg-panel-2 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre">
                {data.obj.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function EdgeList({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: { kind: string; node: CodeObjectDto | undefined }[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow">{title}</div>
      {items.length === 0 && <div className="text-[12.5px] text-faint">Nothing</div>}
      {items.map((i, n) =>
        i.node ? (
          <button
            key={n}
            onClick={() => onOpen(i.node!.id)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.04]"
          >
            <span className="w-14 shrink-0 font-mono text-[10.5px] text-faint uppercase">{i.kind}</span>
            <span className="truncate font-mono">{i.node.name}</span>
          </button>
        ) : null,
      )}
    </div>
  );
}

/** Radial neighbourhood of one object. */
function MiniGraph({ root, nodes, edges, onOpen }: ObjectGraphDto & { onOpen: (id: string) => void }) {
  const others = nodes.filter((n) => n.id !== root.id).slice(0, 14);
  if (others.length === 0) return null;
  const W = 500;
  const H = 260;
  const cx0 = W / 2;
  const cy0 = H / 2;
  const pos = new Map<string, [number, number]>([[root.id, [cx0, cy0]]]);
  others.forEach((n, i) => {
    const a = (i / others.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(n.id, [cx0 + Math.cos(a) * 190, cy0 + Math.sin(a) * 95]);
  });
  return (
    <div className="dot-grid overflow-hidden rounded-xl border border-line">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Dependencies of ${root.name}`}
      >
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={
                e.kind === 'writes' ? '#f5bc62' : e.kind === 'calls' ? '#62c9ff' : 'rgba(161,149,255,.55)'
              }
              strokeWidth="1.3"
              strokeDasharray={e.kind === 'contains' ? '3 4' : undefined}
            />
          );
        })}
        {[root, ...others].map((n) => {
          const p = pos.get(n.id)!;
          const isRoot = n.id === root.id;
          return (
            <g key={n.id} onClick={() => !isRoot && onOpen(n.id)} className={isRoot ? '' : 'cursor-pointer'}>
              <circle
                cx={p[0]}
                cy={p[1]}
                r={isRoot ? 9 : 6}
                fill={isRoot ? '#a195ff' : '#12161f'}
                stroke={isRoot ? '#a195ff' : 'rgba(233,235,243,.5)'}
              />
              <text
                x={p[0]}
                y={p[1] + (isRoot ? 24 : 18)}
                textAnchor="middle"
                fontSize="10.5"
                fill={isRoot ? '#e9ebf3' : '#99a0b7'}
                fontFamily="var(--font-mono)"
              >
                {n.name.length > 26 ? `${n.name.slice(0, 25)}…` : n.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 border-t border-line px-3 py-2 text-[11px] text-faint">
        <span>
          <i className="mr-1 inline-block h-0.5 w-3 bg-run align-middle" />
          calls
        </span>
        <span>
          <i className="mr-1 inline-block h-0.5 w-3 bg-wait align-middle" />
          writes
        </span>
        <span>
          <i className="mr-1 inline-block h-0.5 w-3 bg-accent align-middle" />
          reads / references
        </span>
      </div>
    </div>
  );
}
