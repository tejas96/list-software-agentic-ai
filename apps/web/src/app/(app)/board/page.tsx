'use client';

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, SquareKanban } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  BOARD_COLUMNS,
  checkManualMove,
  STATUS_LABELS,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  type TicketStatus,
  type TicketSummaryDto,
} from '@lsa/contracts';
import { NewTicketModal } from '@/components/new-ticket';
import { TicketCard, TypeBadge } from '@/components/ticket-bits';
import { Button, Chip, cx, EmptyState, ErrorBox, Input, Loading, Select, useToast } from '@/components/ui';
import { PRIORITY_LABELS } from '@/lib/format';
import { useCurrentProject } from '@/lib/project';
import { post, useTickets, type TicketFilters } from '@/lib/queries';
import { useRoom } from '@/lib/realtime';

const COLUMN_HINT: Partial<Record<TicketStatus, string>> = {
  backlog: 'Logged, not yet ready',
  ready: 'Ready for the agents',
  analysing: 'Understand · analyse · plan',
  awaiting_plan_approval: 'Waiting for an approver',
  building: 'Build and test loop',
  verifying: 'Review and security',
  awaiting_release_approval: 'Waiting for an approver',
  releasing: 'Packaging for your CI/CD',
  blocked: 'Needs a person',
  done: 'Released or answered',
  cancelled: 'Stopped',
};

export default function BoardPage() {
  const { project, projects, setProject, isLoading } = useCurrentProject();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [prios, setPrios] = useState<string[]>([]);
  const [mine, setMine] = useState(params.get('mine') === '1');
  const [showCancelled, setShowCancelled] = useState(false);
  const [creating, setCreating] = useState(false);
  useRoom(project ? `project:${project.id}` : null);

  const filters: TicketFilters = {
    projectId: project?.id,
    q: q.trim() || undefined,
    type: types,
    priority: prios,
    mine,
    includeCancelled: showCancelled,
  };
  const tickets = useTickets(filters, !!project);
  const canEdit = !!project?.myRole && project.myRole !== 'viewer';

  if (isLoading) return <Loading />;
  if (!project) {
    return (
      <EmptyState
        icon={<SquareKanban className="size-5" />}
        title="No project selected"
        body="You are not a member of any project yet."
      />
    );
  }

  const columns = showCancelled ? [...BOARD_COLUMNS, 'cancelled' as const] : BOARD_COLUMNS;
  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 px-4 pt-6 pb-4 md:px-7">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <div className="eyebrow">Board</div>
            <div className="flex items-center gap-3">
              <h1 className="text-[26px] font-semibold tracking-tight">{project.name}</h1>
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
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canEdit && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New ticket
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input
              aria-label="Search tickets"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search key, title or text"
              className="h-9 pl-9"
            />
          </div>
          {TICKET_TYPES.map((t) => (
            <Chip key={t} active={types.includes(t)} onClick={() => toggle(types, setTypes, t)}>
              <TypeBadge type={t} />
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-line-2" />
          {TICKET_PRIORITIES.map((p) => (
            <Chip key={p} active={prios.includes(p)} onClick={() => toggle(prios, setPrios, p)}>
              {PRIORITY_LABELS[p]}
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-line-2" />
          <Chip active={mine} onClick={() => setMine(!mine)}>
            Mine
          </Chip>
          <Chip active={showCancelled} onClick={() => setShowCancelled(!showCancelled)}>
            Show cancelled
          </Chip>
        </div>
      </div>
      {tickets.error ? (
        <div className="px-7">
          <ErrorBox error={tickets.error} onRetry={() => void tickets.refetch()} />
        </div>
      ) : tickets.isLoading ? (
        <Loading label="Loading the board" />
      ) : (
        <Columns
          tickets={tickets.data ?? []}
          columns={columns}
          canEdit={canEdit}
          filterKey={JSON.stringify(filters)}
        />
      )}
      <NewTicketModal open={creating} onClose={() => setCreating(false)} project={project} />
    </div>
  );
}

function Columns({
  tickets,
  columns,
  canEdit,
  filterKey,
}: {
  tickets: TicketSummaryDto[];
  columns: readonly TicketStatus[];
  canEdit: boolean;
  filterKey: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [active, setActive] = useState<TicketSummaryDto | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const grouped = useMemo(() => {
    const g = new Map<TicketStatus, TicketSummaryDto[]>();
    for (const c of columns) g.set(c, []);
    for (const t of tickets) g.get(t.status)?.push(t);
    for (const list of g.values()) list.sort((a, b) => a.rank - b.rank);
    return g;
  }, [tickets, columns]);

  const onStart = (e: DragStartEvent) => setActive(tickets.find((t) => t.id === e.active.id) ?? null);

  const onEnd = async (e: DragEndEvent) => {
    setActive(null);
    const t = tickets.find((x) => x.id === e.active.id);
    if (!t || !e.over) return;
    const overId = String(e.over.id);
    const to = (
      overId.startsWith('col:') ? overId.slice(4) : tickets.find((x) => x.id === overId)?.status
    ) as TicketStatus | undefined;
    if (!to) return;
    const list = (grouped.get(to) ?? []).filter((x) => x.id !== t.id);
    let afterId: string | null;
    if (overId.startsWith('col:')) afterId = list.at(-1)?.id ?? null;
    else {
      const idx = list.findIndex((x) => x.id === overId);
      afterId = idx <= 0 ? null : list[idx - 1]!.id;
    }
    const check = checkManualMove(t.status, to, t.activeRun !== null);
    if (!check.ok) {
      toast(check.reason, 'bad');
      return;
    }
    // Optimistic update: move the card now, reconcile with the server response.
    const key = ['tickets', JSON.parse(filterKey)];
    const prev = qc.getQueryData<TicketSummaryDto[]>(key);
    const before = afterId ? (list.find((x) => x.id === afterId)?.rank ?? 0) : (list[0]?.rank ?? 1024) - 1024;
    const next = afterId
      ? (list[list.findIndex((x) => x.id === afterId) + 1]?.rank ?? before + 1024)
      : (list[0]?.rank ?? 1024);
    qc.setQueryData<TicketSummaryDto[]>(key, (old) =>
      old?.map((x) =>
        x.id === t.id ? { ...x, status: to, rank: afterId ? (before + next) / 2 : next - 512 } : x,
      ),
    );
    try {
      await post(`/tickets/${t.key}/move`, { status: to, afterId, version: t.version });
      if (to !== t.status) toast(`${t.key} moved to ${STATUS_LABELS[to]}`);
    } catch (err) {
      qc.setQueryData(key, prev);
      toast(err instanceof Error ? err.message : 'Could not move the ticket', 'bad');
    } finally {
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onStart}
      onDragEnd={onEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-6 md:px-7">
        {columns.map((c) => (
          <Column key={c} status={c} items={grouped.get(c) ?? []} canEdit={canEdit} dragging={active} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0.8,0.2,1)' }}>
        {active ? <TicketCard t={active} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  items,
  canEdit,
  dragging,
}: {
  status: TicketStatus;
  items: TicketSummaryDto[];
  canEdit: boolean;
  dragging: TicketSummaryDto | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  const allowed = dragging ? checkManualMove(dragging.status, status, dragging.activeRun !== null).ok : true;
  const tone =
    status === 'blocked'
      ? 'text-bad'
      : status.startsWith('awaiting')
        ? 'text-wait'
        : ['analysing', 'building', 'verifying', 'releasing'].includes(status)
          ? 'text-run'
          : status === 'done'
            ? 'text-ok'
            : 'text-muted';
  return (
    <section
      ref={setNodeRef}
      aria-label={STATUS_LABELS[status]}
      className={cx(
        'flex w-[272px] shrink-0 flex-col rounded-[18px] border bg-panel/60 transition',
        dragging && !allowed ? 'opacity-45' : '',
        isOver && allowed ? 'border-accent/45 bg-accent/[0.04]' : 'border-line',
      )}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
        <span className={cx('text-[13px] font-semibold', tone)}>{STATUS_LABELS[status]}</span>
        <span className="rounded-full bg-white/6 px-1.5 font-mono text-[10.5px] leading-5 text-muted">
          {items.length}
        </span>
      </header>
      <p className="px-3.5 pb-2 text-[11.5px] text-faint">{COLUMN_HINT[status]}</p>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-3">
          {items.map((t) => (
            <SortableCard key={t.id} t={t} disabled={!canEdit} />
          ))}
          {items.length === 0 && (
            <div className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[12px] text-faint">
              Empty
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ t, disabled }: { t: TicketSummaryDto; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(isDragging && 'opacity-30')}
      {...attributes}
      {...listeners}
    >
      <TicketCard t={t} />
    </div>
  );
}
