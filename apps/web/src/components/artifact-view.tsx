'use client';

import { FileText } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AGENTS, ARTIFACT_LABELS, type ArtifactDto } from '@lsa/contracts';
import { dateTime } from '@/lib/format';
import { useArtifact } from '@/lib/queries';
import { AgentIcon } from './agent-icon';
import { cx, ErrorBox, Loading, Modal, Pill } from './ui';

type Any = Record<string, unknown>;

function List({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="eyebrow">{title}</div>
      <ul className="flex flex-col gap-1.5">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />
            {x}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Table({
  title,
  head,
  rows,
}: {
  title?: string;
  head: string[];
  rows: (string | React.ReactNode)[][];
}) {
  if (!rows.length) return null;
  return (
    <section className="flex flex-col gap-2">
      {title && <div className="eyebrow">{title}</div>}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-panel-2 text-[11.5px] text-faint">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line align-top">
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-2">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const sev = (s: string) => (
  <span
    className={cx(
      'font-mono text-[11px] uppercase',
      s === 'blocker' ? 'text-bad' : s === 'major' ? 'text-wait' : 'text-muted',
    )}
  >
    {s}
  </span>
);
const status = (s: string) => (
  <span
    className={cx(
      'font-mono text-[11px] uppercase',
      s === 'passed' || s === 'pass' ? 'text-ok' : s === 'failed' || s === 'fail' ? 'text-bad' : 'text-muted',
    )}
  >
    {s.replace('_', ' ')}
  </span>
);
const mono = (s: string | null | undefined) => (s ? <span className="font-mono text-[12px]">{s}</span> : '—');

/** Readable rendering of every artifact kind. Unknown shapes fall back to JSON. */
export function ArtifactBody({ a }: { a: ArtifactDto }) {
  const c = a.content as Any;
  switch (a.kind) {
    case 'requirement_spec':
      return (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed">{String(c.summary)}</p>
          {c.userStory ? (
            <p className="rounded-xl border border-line bg-panel-2 px-4 py-3 text-[13.5px] italic">
              {String(c.userStory)}
            </p>
          ) : null}
          <Table
            title="Requirements"
            head={['Id', 'Requirement']}
            rows={(c.requirements as Any[]).map((r) => [mono(String(r.id)), String(r.text)])}
          />
          <Table
            title="Acceptance criteria"
            head={['Id', 'Given', 'When', 'Then']}
            rows={(c.acceptanceCriteria as Any[]).map((r) => [
              mono(String(r.id)),
              String(r.given),
              String(r.when),
              String(r.then),
            ])}
          />
          <List title="Assumptions" items={c.assumptions as string[]} />
          <List title="Open questions" items={c.openQuestions as string[]} />
          <List title="Out of scope" items={c.outOfScope as string[]} />
        </div>
      );
    case 'business_context':
      return (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed">{String(c.process)}</p>
          <List title="Affected roles" items={c.affectedRoles as string[]} />
          <Table
            title="Business rules"
            head={['Id', 'Rule']}
            rows={(c.businessRules as Any[]).map((r) => [mono(String(r.id)), String(r.rule)])}
          />
          <List title="Risks" items={c.risks as string[]} />
          <List title="Regulatory considerations" items={c.regulatoryNotes as string[]} />
        </div>
      );
    case 'impact_map':
      return (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed">{String(c.summary)}</p>
          {c.rootCause ? (
            <div className="rounded-xl border border-bad/25 bg-bad/5 px-4 py-3 text-[13.5px]">
              <div className="eyebrow mb-1 !text-bad">Root cause</div>
              {String(c.rootCause)}
            </div>
          ) : null}
          <Table
            title="Components"
            head={['Component', 'Kind', 'Change', 'Why']}
            rows={(c.components as Any[]).map((r) => [
              mono(String(r.name)),
              String(r.kind),
              status(String(r.changeType)),
              String(r.reason),
            ])}
          />
          <Table
            title="Dependencies"
            head={['From', 'Relation', 'To']}
            rows={(c.dependencies as Any[]).map((r) => [
              mono(String(r.from)),
              String(r.relation),
              mono(String(r.to)),
            ])}
          />
          <Table
            title="Evidence"
            head={['Component', 'Finding']}
            rows={(c.evidence as Any[]).map((r) => [mono(String(r.component)), String(r.finding)])}
          />
          <List title="Risks" items={c.risks as string[]} />
        </div>
      );
    case 'change_plan':
      return (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed">{String(c.summary)}</p>
          <Table
            title={`Changes · ${String(c.complexity)} complexity`}
            head={['#', 'Component', 'Change', 'Owner']}
            rows={[...(c.changes as Any[])]
              .sort((x, y) => Number(x.order) - Number(y.order))
              .map((r) => [
                mono(String(r.id)),
                mono(String(r.component)),
                String(r.description),
                AGENTS[r.owner as 'developer'].name,
              ])}
          />
          <Table
            title="Proved by"
            head={['Change', 'Tests']}
            rows={(c.testsByChange as Any[]).map((r) => [
              mono(String(r.changeId)),
              (r.testIds as string[]).join(', '),
            ])}
          />
          <Table
            title="Risks"
            head={['Risk', 'Mitigation']}
            rows={(c.risks as Any[]).map((r) => [String(r.risk), String(r.mitigation)])}
          />
          <section>
            <div className="eyebrow mb-1.5">Rollback</div>
            <p className="text-[13.5px] leading-relaxed">{String(c.rollback)}</p>
          </section>
          {c.notes ? <p className="text-[13px] text-muted">{String(c.notes)}</p> : null}
        </div>
      );
    case 'test_plan':
      return (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed">{String(c.strategy)}</p>
          <Table
            title="Test cases"
            head={['Id', 'Test', 'Type', 'Criterion', 'Expected']}
            rows={(c.cases as Any[]).map((r) => [
              mono(String(r.id)),
              String(r.title),
              String(r.type) + (r.automated ? '' : ' · manual'),
              mono(r.criterionId as string | null),
              String(r.expected),
            ])}
          />
        </div>
      );
    case 'code_change':
      return (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <Pill tone={c.compiled ? 'ok' : 'bad'}>{c.compiled ? 'Compiles' : 'Not compiled'}</Pill>
            {c.commit ? (
              <span className="font-mono text-[11.5px] text-faint">
                commit {String(c.commit).slice(0, 10)}
              </span>
            ) : null}
          </div>
          <p className="text-[14px] leading-relaxed">{String(c.summary)}</p>
          <Table
            title="Files"
            head={['File', 'Action', 'What changed']}
            rows={(c.files as Any[]).map((r) => [
              mono(String(r.path)),
              String(r.action),
              String(r.description),
            ])}
          />
          <List title="Notes" items={c.notes as string[]} />
          {c.compileLog ? (
            <pre className="max-h-60 overflow-auto rounded-xl bg-panel-2 p-3 font-mono text-[11.5px] whitespace-pre-wrap">
              {String(c.compileLog)}
            </pre>
          ) : null}
        </div>
      );
    case 'db_change':
      return (
        <div className="flex flex-col gap-5">
          <div className="flex gap-2">
            <Pill tone={c.needed ? 'accent' : 'idle'}>
              {c.needed ? 'Database changes' : 'No database change needed'}
            </Pill>
            {c.needed ? (
              <Pill tone={c.rollbackVerified ? 'ok' : 'wait'}>
                {c.rollbackVerified ? 'Rollback verified' : 'Rollback not verified'}
              </Pill>
            ) : null}
          </div>
          <p className="text-[14px] leading-relaxed">{String(c.summary)}</p>
          <Table
            title="Scripts"
            head={['Script', 'Kind', 'Purpose']}
            rows={(c.scripts as Any[]).map((r) => [mono(String(r.path)), String(r.kind), String(r.purpose)])}
          />
          <List title="Notes" items={c.notes as string[]} />
        </div>
      );
    case 'test_results':
      return (
        <div className="flex flex-col gap-5">
          <Pill tone={c.passed ? 'ok' : 'bad'}>
            {c.passed ? 'All automated tests passed' : 'Tests failing'}
          </Pill>
          <p className="text-[14px] leading-relaxed">{String(c.summary)}</p>
          <Table
            title="Results"
            head={['Id', 'Test', 'Result', 'Details']}
            rows={(c.results as Any[]).map((r) => [
              mono(String(r.caseId)),
              String(r.title),
              status(String(r.status)),
              String(r.details) +
                (r.failureCategory ? ` [${String(r.failureCategory).replace('_', ' ')}]` : ''),
            ])}
          />
          {c.command ? (
            <div className="text-[12.5px] text-muted">Command: {mono(String(c.command))}</div>
          ) : null}
          {c.log ? (
            <pre className="max-h-60 overflow-auto rounded-xl bg-panel-2 p-3 font-mono text-[11.5px] whitespace-pre-wrap">
              {String(c.log)}
            </pre>
          ) : null}
        </div>
      );
    case 'review_report':
    case 'security_report':
      return (
        <div className="flex flex-col gap-5">
          <Pill tone={c.approved ? 'ok' : 'bad'}>{c.approved ? 'Approved' : 'Changes required'}</Pill>
          <p className="text-[14px] leading-relaxed">{String(c.summary)}</p>
          {a.kind === 'security_report' && (
            <Table
              title="Checks"
              head={['Check', 'Result', 'Notes']}
              rows={(c.checks as Any[]).map((r) => [
                String(r.check),
                status(String(r.result)),
                String(r.notes),
              ])}
            />
          )}
          <Table
            title="Findings"
            head={['Severity', 'Where', 'Issue', 'Recommendation']}
            rows={(c.findings as Any[]).map((r) => [
              sev(String(r.severity)),
              mono(r.file ? `${String(r.file)}${r.line ? `:${String(r.line)}` : ''}` : null),
              String(r.issue),
              String(r.recommendation),
            ])}
          />
        </div>
      );
    case 'release_package':
      return (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed">{String(c.summary)}</p>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            Branch {mono(String(c.branch))}
            {c.pullRequestUrl ? (
              <a
                href={String(c.pullRequestUrl)}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Pull request ↗
              </a>
            ) : null}
          </div>
          <Table
            title="Deployment order"
            head={['Step', 'Item', 'Notes']}
            rows={(c.deploymentOrder as Any[]).map((r) => [
              String(r.step),
              mono(String(r.item)),
              String(r.notes),
            ])}
          />
          <section>
            <div className="eyebrow mb-1.5">Rollback plan</div>
            <p className="text-[13.5px] leading-relaxed">{String(c.rollbackPlan)}</p>
          </section>
          <Table
            title="Manifest"
            head={['Path', 'Kind']}
            rows={(c.manifest as Any[]).map((r) => [mono(String(r.path)), String(r.kind)])}
          />
        </div>
      );
    case 'release_notes':
    case 'analysis_report':
      return (
        <div className="flex flex-col gap-4">
          {a.kind === 'release_notes' && (
            <div className="text-[12.5px] text-muted">For: {String(c.audience)}</div>
          )}
          <div className="prose-lsa text-[14px]">
            <ReactMarkdown>{String(c.markdown)}</ReactMarkdown>
          </div>
          {a.kind === 'analysis_report' && (
            <List title="Recommendations" items={c.recommendations as string[]} />
          )}
        </div>
      );
    default:
      return (
        <pre className="overflow-auto rounded-xl bg-panel-2 p-3 font-mono text-[11.5px]">
          {JSON.stringify(c, null, 2)}
        </pre>
      );
  }
}

export function ArtifactModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useArtifact(id);
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      width={860}
      title={
        q.data ? (
          <div className="flex items-center gap-3">
            <AgentIcon agent={q.data.agentKey} tone="accent" size={36} />
            <div>
              <div>{q.data.title}</div>
              <div className="text-[12.5px] font-normal text-muted">
                {q.data.agentKey ? AGENTS[q.data.agentKey].name : 'Platform'} · version {q.data.version} ·{' '}
                {dateTime(q.data.createdAt)}
              </div>
            </div>
          </div>
        ) : (
          'Artifact'
        )
      }
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data ? (
        <ArtifactBody a={q.data} />
      ) : null}
    </Modal>
  );
}

/** A chip that opens an artifact. */
export function ArtifactLink({ id, label }: { id: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const q = useArtifact(open ? null : id);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[10px] border border-line-2 bg-panel-2 px-3 py-2 text-[12.5px] transition hover:border-accent/40"
      >
        <FileText className="size-3.5 text-accent" />
        {label ?? (q.data ? q.data.title : 'Open')}
      </button>
      <ArtifactModal id={open ? id : null} onClose={() => setOpen(false)} />
    </>
  );
}

export { ARTIFACT_LABELS };
