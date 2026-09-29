'use client';

import { AGENT_ORDER, AGENTS, TASKS, TOOL_GROUP_LABELS, WORKFLOWS } from '@lsa/contracts';
import { AgentIcon } from '@/components/agent-icon';
import { Card, Pill } from '@/components/ui';
import { useWorkspaceStatus } from '@/lib/queries';

export default function AgentsPage() {
  const status = useWorkspaceStatus().data;
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Your team</div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Agents</h1>
          <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted">
            Each agent owns one job in the lifecycle and loads expert skills on demand. They act only through
            tools: the knowledge graph, a sandbox branch of your repository, allow-listed commands and the
            Oracle adapter. They never touch production.
          </p>
        </div>
        {status && (
          <Pill tone={status.llm.configured ? 'ok' : 'wait'}>
            {status.llm.configured ? `Model ${status.llm.model}` : 'No LLM key configured'}
          </Pill>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AGENT_ORDER.map((k) => {
          const a = AGENTS[k];
          const tasks = Object.values(TASKS).filter((t) => t.agent === k);
          return (
            <Card key={k} className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-3">
                <AgentIcon agent={k} tone="accent" size={42} />
                <div>
                  <div className="text-[15px] font-semibold">{a.name}</div>
                  <div className="eyebrow mt-0.5">{a.stage ? `Stage · ${a.stage}` : 'Every stage'}</div>
                </div>
              </div>
              <p className="text-[13.5px] leading-relaxed text-muted">{a.description}</p>
              <div className="flex flex-col gap-2">
                <div className="eyebrow">Tasks</div>
                <ul className="flex flex-col gap-1 text-[13px]">
                  {tasks.map((t) => (
                    <li key={t.task} className="flex gap-2">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                      {t.title}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2">
                <div className="eyebrow">Skills</div>
                <div className="flex flex-wrap gap-1.5">
                  {a.skills.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-line-2 px-2.5 py-1 text-[11.5px] text-muted"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="eyebrow">Can use</div>
                <ul className="flex flex-col gap-1 text-[12.5px] text-muted">
                  {a.toolGroups.map((g) => (
                    <li key={g}>{TOOL_GROUP_LABELS[g]}</li>
                  ))}
                </ul>
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Workflows</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {Object.values(WORKFLOWS).map((w) => (
            <div key={w.type} className="rounded-xl border border-line bg-panel-2 p-4">
              <div className="text-[14px] font-semibold">{w.name}</div>
              <p className="mt-1 text-[12.5px] text-muted">{w.description}</p>
              <ol className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
                {w.stages.map((s, i) => (
                  <li key={s.key}>
                    {s.gateBefore && (
                      <div className="mb-1.5 font-mono text-[10.5px] text-wait uppercase">
                        ◆ {s.gateBefore} approval
                      </div>
                    )}
                    <span className="font-mono text-faint">{i + 1}.</span> {s.name}
                    <span className="text-faint">
                      {' '}
                      —{' '}
                      {s.groups
                        .flat()
                        .map((t) => AGENTS[TASKS[t].agent].shortName)
                        .join(', ')}
                    </span>
                    {s.qaLoop && <span className="text-accent"> + test/fix loop</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
