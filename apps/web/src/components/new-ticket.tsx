'use client';

import { Plus, Trash } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  TICKET_PRIORITIES,
  TICKET_TYPES,
  type ProjectDto,
  type TicketDto,
  type TicketPriority,
  type TicketType,
} from '@lsa/contracts';
import { PRIORITY_LABELS, TYPE_LABELS } from '@/lib/format';
import { keys, post, useAction, useMembers } from '@/lib/queries';
import { Button, Field, IconButton, Input, Modal, Select, Textarea, Toggle, errorText, useToast } from './ui';

/** Log a ticket from the board with full details. The agents triage anything left empty. */
export function NewTicketModal({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectDto;
}) {
  const toast = useToast();
  const router = useRouter();
  const members = useMembers(project.id).data ?? [];
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TicketType>('feature');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [labels, setLabels] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [criteria, setCriteria] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [startRun, setStartRun] = useState(false);

  const create = useAction(
    (body: unknown) => post<TicketDto>('/tickets', body),
    [['tickets'], keys.dashboard],
  );

  const reset = () => {
    setTitle('');
    setDescription('');
    setType('feature');
    setPriority('medium');
    setAssigneeId('');
    setLabels('');
    setDueDate('');
    setCriteria([]);
    setReady(false);
    setStartRun(false);
  };

  const submit = async () => {
    try {
      const t = await create.mutateAsync({
        projectId: project.id,
        title: title.trim(),
        description,
        type,
        priority,
        assigneeId: assigneeId || null,
        labels: labels
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean),
        dueDate: dueDate || null,
        acceptanceCriteria: criteria
          .map((c) => c.trim())
          .filter(Boolean)
          .map((text, i) => ({ id: `AC${i + 1}`, text })),
        status: ready || startRun ? 'ready' : 'backlog',
        startRun,
      });
      toast(`Created ${t.key}${startRun ? ' and started the run' : ''}`);
      reset();
      onClose();
      router.push(`/tickets/${t.key}`);
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={720}
      title={`New ticket in ${project.key}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={title.trim().length < 3}
            onClick={submit}
          >
            Create ticket
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add customer address to account opening"
                maxLength={160}
              />
            )}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            label="Description"
            hint="Markdown supported. Include the business need, where it shows up, and anything that must not change."
          >
            {(id) => (
              <Textarea
                id={id}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
              />
            )}
          </Field>
        </div>
        <Field label="Type">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as TicketType)}>
              {TICKET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority">
          {(id) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Assignee">
          {(id) => (
            <Select id={id} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Due date">
          {(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Labels" hint="Comma separated, e.g. account-opening, reports">
            {(id) => <Input id={id} value={labels} onChange={(e) => setLabels(e.target.value)} />}
          </Field>
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <div className="text-[12.5px] font-medium text-muted">Acceptance criteria</div>
          {criteria.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-9 shrink-0 font-mono text-[11.5px] text-faint">AC{i + 1}</span>
              <Input
                aria-label={`Acceptance criterion ${i + 1}`}
                value={c}
                onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <IconButton
                label="Remove criterion"
                onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
              >
                <Trash className="size-4" />
              </IconButton>
            </div>
          ))}
          <div>
            <Button size="sm" variant="ghost" onClick={() => setCriteria([...criteria, ''])}>
              <Plus className="size-3.5" /> Add criterion
            </Button>
            {criteria.length === 0 && (
              <span className="ml-3 text-[12px] text-faint">
                Leave empty and the Requirement Analyst drafts them.
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Toggle
            checked={ready}
            onChange={setReady}
            label="Put it straight in Ready"
            description="Ready means the team can start work on it."
          />
          <Toggle
            checked={startRun}
            onChange={setStartRun}
            label="Start the agent run now"
            description="Runs the workflow for this ticket type. You still approve at the gates."
          />
        </div>
      </div>
    </Modal>
  );
}
