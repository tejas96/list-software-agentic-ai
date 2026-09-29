'use client';

import { Check, RotateCcw, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { GateDto } from '@lsa/contracts';
import { ago } from '@/lib/format';
import { keys, post, useAction } from '@/lib/queries';
import { ArtifactLink } from './artifact-view';
import { Button, cx, errorText, Modal, Pill, Textarea, useToast } from './ui';

const TITLES = {
  plan: 'Approve the change plan?',
  release: 'Approve the release?',
  escalation: 'The run needs a person',
} as const;
const EXPLAIN = {
  plan: 'Approving lets the Developer and Database agents start work in the sandbox branch. Nothing reaches production from this gate.',
  release:
    'Approving pushes the work branch to your repository and hands it to your CI/CD. The platform never deploys to production itself.',
  escalation:
    'An agent could not continue safely on its own. Fix the cause if needed, then retry the step, or stop the run.',
} as const;

const TONE_CLASS = { ok: 'text-ok', warn: 'text-wait', bad: 'text-bad', neutral: 'text-text' } as const;

/** The decision dialog for one gate: summary, evidence links, and approve / send back / reject. */
export function GateDialog({
  gate,
  open,
  onClose,
}: {
  gate: GateDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'changes' | 'reject'>('view');
  const [note, setNote] = useState('');
  const decide = useAction(
    (v: { decision: 'approved' | 'changes_requested' | 'rejected'; note?: string }) =>
      post<GateDto>(`/approvals/${gate!.id}/decision`, v),
    [keys.approvals, ['ticket'], ['run'], ['tickets'], keys.dashboard],
  );

  if (!gate) return null;
  const close = () => {
    setMode('view');
    setNote('');
    onClose();
  };
  const submit = async (decision: 'approved' | 'changes_requested' | 'rejected') => {
    try {
      await decide.mutateAsync({ decision, note: note.trim() || undefined });
      toast(
        decision === 'approved'
          ? gate.kind === 'escalation'
            ? 'Retrying the step'
            : gate.kind === 'plan'
              ? 'Plan approved. Building starts in the sandbox.'
              : 'Release approved. Handing to your CI/CD.'
          : decision === 'changes_requested'
            ? 'Sent back with your note'
            : gate.kind === 'escalation'
              ? 'Run stopped'
              : 'Rejected. The run has stopped.',
      );
      close();
    } catch (err) {
      toast(errorText(err), 'bad');
    }
  };

  const isEsc = gate.kind === 'escalation';
  return (
    <Modal
      open={open}
      onClose={close}
      width={660}
      title={
        <div className="flex flex-col gap-2.5">
          <span className="self-start">
            <Pill
              tone={isEsc ? 'bad' : gate.status === 'pending' ? 'wait' : 'idle'}
              live={gate.status === 'pending'}
            >
              {gate.projectKey} · {gate.ticketKey} ·{' '}
              {isEsc ? 'Escalation' : `${gate.kind === 'plan' ? 'Gate 1' : 'Gate 2'} · your decision`}
            </Pill>
          </span>
          <span>{TITLES[gate.kind]}</span>
          <span className="text-[13.5px] font-normal text-muted">{gate.ticketTitle}</span>
        </div>
      }
      footer={
        gate.status !== 'pending' ? (
          <Button onClick={close}>Close</Button>
        ) : !gate.canDecide ? (
          <>
            <span className="mr-auto self-center text-[12.5px] text-faint">{gate.cannotDecideReason}</span>
            <Button onClick={close}>Close</Button>
          </>
        ) : mode === 'view' ? (
          <>
            {isEsc ? (
              <Button variant="danger" onClick={() => setMode('reject')}>
                <X className="size-4" /> Stop the run
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setMode('reject')}>
                  Reject
                </Button>
                <Button variant="ghost" onClick={() => setMode('changes')}>
                  <RotateCcw className="size-4" /> Request changes
                </Button>
              </>
            )}
            <Button variant="warn" loading={decide.isPending} onClick={() => submit('approved')}>
              <Check className="size-4" />{' '}
              {isEsc
                ? 'Retry the step'
                : gate.kind === 'plan'
                  ? 'Approve and start build'
                  : 'Approve release'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMode('view')}>
              Back
            </Button>
            <Button
              variant={mode === 'reject' ? 'danger' : 'warn'}
              loading={decide.isPending}
              disabled={mode === 'changes' && note.trim().length < 3}
              onClick={() => submit(mode === 'changes' ? 'changes_requested' : 'rejected')}
            >
              {mode === 'changes'
                ? 'Send back to the agents'
                : isEsc
                  ? 'Stop the run'
                  : 'Reject and stop the run'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {gate.status !== 'pending' && (
          <div className="rounded-xl border border-line bg-panel-2 px-4 py-3 text-[13px]">
            {gate.decidedBy ? `${gate.decidedBy.name} ` : ''}
            {gate.status.replace('_', ' ')} {ago(gate.decidedAt)}
            {gate.note && <div className="mt-1 text-muted">“{gate.note}”</div>}
          </div>
        )}
        <div className="overflow-hidden rounded-xl border border-line">
          {gate.summary.points.map((p) => (
            <div
              key={p.label}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-line px-4 py-2.5 text-[13.5px] last:border-0"
            >
              <span className="text-muted">{p.label}</span>
              <span className={cx('text-right', TONE_CLASS[p.tone ?? 'neutral'])}>{p.value}</span>
            </div>
          ))}
        </div>
        {gate.summary.artifactIds.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="eyebrow">Evidence to review</div>
            <div className="flex flex-wrap gap-2">
              {gate.summary.artifactIds.map((id) => (
                <ArtifactLink key={id} id={id} />
              ))}
            </div>
          </div>
        )}
        <div
          className={cx(
            'flex gap-3 rounded-xl border px-4 py-3.5 text-[13px] leading-relaxed',
            isEsc ? 'border-bad/25 bg-bad/5 text-[#ffd1c8]' : 'border-ok/22 bg-ok/6 text-[#bfebd5]',
          )}
        >
          {isEsc ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
          ) : (
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
          )}
          <span>{EXPLAIN[gate.kind]}</span>
        </div>
        {mode !== 'view' && (
          <div className="flex flex-col gap-2">
            <label htmlFor="gate-note" className="text-[12.5px] font-medium text-muted">
              {mode === 'changes'
                ? 'What should change? The agents will read this.'
                : 'Reason (recorded in the audit trail)'}
            </label>
            <Textarea
              id="gate-note"
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                mode === 'changes' ? 'e.g. Keep the report change for a separate ticket' : 'Optional'
              }
            />
          </div>
        )}
        <Link
          href={`/runs/${gate.runId}`}
          className="text-[12.5px] text-accent hover:underline"
          onClick={close}
        >
          Open the run pipeline →
        </Link>
      </div>
    </Modal>
  );
}

/** Inline "needs you" card for a pending gate. */
export function GateCard({ gate, onOpen }: { gate: GateDto; onOpen: () => void }) {
  const isEsc = gate.kind === 'escalation';
  return (
    <div
      className={cx(
        'relative flex flex-col gap-3 overflow-hidden rounded-[18px] border p-5',
        isEsc
          ? 'border-bad/40 bg-[linear-gradient(180deg,rgba(255,138,122,0.07),transparent_60%)]'
          : 'border-wait/40 bg-[linear-gradient(180deg,rgba(245,188,98,0.07),transparent_60%)]',
        'bg-panel',
      )}
    >
      <div className="flex items-center gap-2">
        <Pill tone={isEsc ? 'bad' : 'wait'} live>
          {isEsc ? 'Needs a person' : 'Needs you'}
        </Pill>
        <span className="font-mono text-[11px] text-faint">
          {gate.ticketKey} · {ago(gate.requestedAt)}
        </span>
      </div>
      <div className="text-[16px] leading-snug font-semibold">{gate.summary.headline}</div>
      <div className="line-clamp-2 text-[13px] text-muted">
        {isEsc ? gate.summary.reason : gate.ticketTitle}
      </div>
      <div className="flex gap-2">
        <Button variant={isEsc ? 'default' : 'warn'} onClick={onOpen} className="flex-1">
          {gate.canDecide ? 'Review and decide' : 'View details'}
        </Button>
      </div>
    </div>
  );
}
