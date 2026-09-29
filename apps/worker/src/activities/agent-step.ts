import { ApplicationFailure, Context, heartbeat } from '@temporalio/activity';
import { and, desc, eq, sql } from 'drizzle-orm';
import { runAgentTask, LlmError, type KnowledgeAccess, type TaskContext } from '@lsa/agents';
import {
  AGENTS,
  ARTIFACT_LABELS,
  STAGE_KEYS,
  TASKS,
  type AgentTask,
  type ArtifactKind,
  type StageKey,
} from '@lsa/contracts';
import { appendActivity, artifacts, llmUsage, projects, publish, runs, runSteps, tickets } from '@lsa/db';
import { knowledgeDependencies, knowledgeObjectByName, searchKnowledge } from '@lsa/domain';
import type { Deps } from '../deps.js';
import { prepareRunEnvironment } from './workspace.js';

export interface AgentStepInput {
  runId: string;
  task: AgentTask;
  stage: StageKey;
  feedback: string[];
}

export interface AgentStepResult {
  status: 'completed' | 'blocked';
  artifactId: string | null;
  artifactKind: ArtifactKind | null;
  /** Small facts the workflow branches on. */
  passed: boolean | null;
  approved: boolean | null;
  failures: string[];
  needed: string | null;
  reason: string | null;
  commit: string | null;
}

const WRITES_FILES: AgentTask[] = [
  'implement_change',
  'implement_db_change',
  'run_tests',
  'fix_failures',
  'reproduce_defect',
];

export function agentStepActivities(deps: Deps) {
  const { db } = deps;

  const knowledgeFor = (projectId: string): KnowledgeAccess => ({
    search: async (q, kind) =>
      (await searchKnowledge(db, projectId, q, { kind, limit: 15 })).map((h) => ({
        name: h.name,
        kind: h.kind,
        path: h.path,
        summary: h.summary,
        snippet: h.snippet,
      })),
    object: async (name) => knowledgeObjectByName(db, projectId, name),
    dependencies: (name, direction, depth) => knowledgeDependencies(db, projectId, name, direction, depth),
  });

  return {
    async runAgentStep(input: AgentStepInput): Promise<AgentStepResult> {
      const def = TASKS[input.task];
      const [run] = await db.select().from(runs).where(eq(runs.id, input.runId));
      if (!run) throw ApplicationFailure.nonRetryable('Run not found', 'NotFound');
      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, run.ticketId));
      const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId));
      if (!STAGE_KEYS.includes(input.stage))
        throw ApplicationFailure.nonRetryable('Unknown stage', 'Invalid');

      // A new attempt row for every execution (retries included), so the history is complete.
      const [prev] = await db
        .select({ attempt: runSteps.attempt })
        .from(runSteps)
        .where(and(eq(runSteps.runId, input.runId), eq(runSteps.task, input.task)))
        .orderBy(desc(runSteps.attempt))
        .limit(1);
      const attempt = (prev?.attempt ?? 0) + 1;
      const step = await db.transaction(async (tx) => {
        const [s] = await tx
          .insert(runSteps)
          .values({
            runId: run.id,
            stage: input.stage,
            task: input.task,
            agentKey: def.agent,
            title: def.title,
            status: 'running',
            attempt,
            startedAt: new Date(),
            currentAction: 'Starting',
          })
          .returning();
        await appendActivity(tx, {
          projectId: run.projectId,
          ticketId: run.ticketId,
          runId: run.id,
          actorType: 'agent',
          agentKey: def.agent,
          type: 'step.started',
          summary: `${AGENTS[def.agent].name} started: ${def.title}${attempt > 1 ? ` (attempt ${attempt})` : ''}`,
          data: { stepId: s!.id, task: input.task, attempt },
        });
        await publish(tx, {
          type: 'step.changed',
          projectId: run.projectId,
          ticketId: run.ticketId,
          runId: run.id,
          stepId: s!.id,
        });
        return s!;
      });

      const fail = async (message: string) => {
        await db.transaction(async (tx) => {
          await tx
            .update(runSteps)
            .set({ status: 'failed', error: message, finishedAt: new Date(), currentAction: null })
            .where(eq(runSteps.id, step.id));
          await appendActivity(tx, {
            projectId: run.projectId,
            ticketId: run.ticketId,
            runId: run.id,
            actorType: 'agent',
            agentKey: def.agent,
            type: 'step.failed',
            summary: `${AGENTS[def.agent].name} could not finish “${def.title}”: ${message}`,
            data: { stepId: step.id, task: input.task },
          });
          await publish(tx, {
            type: 'step.changed',
            projectId: run.projectId,
            ticketId: run.ticketId,
            runId: run.id,
            stepId: step.id,
          });
        });
      };

      // Keep Temporal informed while the agent works, and pick up cancellation.
      const beat = setInterval(() => heartbeat({ step: step.id }), 20_000);
      const signal = Context.current().cancellationSignal;
      try {
        const env = await prepareRunEnvironment(db, deps.box, deps.config, run.id, def.needsWorkspace);
        const budget = env.settings.runBudgetUsd;

        // Inputs: the latest version of every artifact the task reads.
        const inputs: TaskContext['artifacts'] = [];
        for (const kind of def.reads) {
          const [a] = await db
            .select()
            .from(artifacts)
            .where(and(eq(artifacts.runId, run.id), eq(artifacts.kind, kind)))
            .orderBy(desc(artifacts.version))
            .limit(1);
          if (a) inputs.push({ kind, title: a.title, content: a.content });
        }

        let lastProgress = 0;
        const outcome = await runAgentTask({
          task: input.task,
          llm: deps.llm,
          skills: deps.skills,
          signal,
          context: {
            project: {
              key: project!.key,
              name: project!.name,
              clientName: project!.clientName,
              techStack: project!.techStack,
            },
            ticket: {
              key: ticket!.key,
              type: ticket!.type,
              priority: ticket!.priority,
              title: ticket!.title,
              description: ticket!.description,
              acceptanceCriteria: ticket!.acceptanceCriteria,
            },
            artifacts: inputs,
            feedback: input.feedback,
            environment: {
              workspace: env.workspace !== null,
              branch: env.branch,
              oracleForms: env.oracle.capabilities.forms,
              oracleReports: env.oracle.capabilities.reports,
              sandboxDb: env.oracle.capabilities.sandboxDb,
              testCommand: env.settings.testCommand,
              buildCommand: env.settings.buildCommand,
              allowedCommands: env.settings.allowedCommands,
            },
          },
          tools: {
            workspace: env.workspace,
            oracle: env.oracle,
            knowledge: knowledgeFor(run.projectId),
            progress: async (action) => {
              heartbeat({ step: step.id, action });
              const now = Date.now();
              if (now - lastProgress < 1500) return; // throttle UI updates
              lastProgress = now;
              await db.transaction(async (tx) => {
                await tx
                  .update(runSteps)
                  .set({ currentAction: action.slice(0, 300) })
                  .where(eq(runSteps.id, step.id));
                await publish(tx, {
                  type: 'step.changed',
                  projectId: run.projectId,
                  ticketId: run.ticketId,
                  runId: run.id,
                  stepId: step.id,
                });
              });
            },
          },
          onUsage: async (u) => {
            const [totals] = await db.transaction(async (tx) => {
              await tx.insert(llmUsage).values({
                runId: run.id,
                stepId: step.id,
                projectId: run.projectId,
                agentKey: def.agent,
                purpose: input.task,
                model: u.model,
                inputTokens: u.inputTokens,
                outputTokens: u.outputTokens,
                cacheReadTokens: u.cacheReadTokens,
                cacheWriteTokens: u.cacheWriteTokens,
                costUsd: u.costUsd,
              });
              await tx
                .update(runSteps)
                .set({ costUsd: sql`${runSteps.costUsd} + ${u.costUsd}` })
                .where(eq(runSteps.id, step.id));
              return tx
                .update(runs)
                .set({
                  costUsd: sql`${runs.costUsd} + ${u.costUsd}`,
                  tokensIn: sql`${runs.tokensIn} + ${u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens}`,
                  tokensOut: sql`${runs.tokensOut} + ${u.outputTokens}`,
                })
                .where(eq(runs.id, run.id))
                .returning({ cost: runs.costUsd });
            });
            const within = Number(totals?.cost ?? 0) < budget;
            if (!within) {
              await appendActivity(db, {
                projectId: run.projectId,
                ticketId: run.ticketId,
                runId: run.id,
                actorType: 'system',
                type: 'budget.exceeded',
                summary: `Run reached its budget of $${budget.toFixed(2)}`,
                data: { budgetUsd: budget, costUsd: Number(totals?.cost ?? 0) },
              }).catch(() => undefined);
            }
            return within;
          },
        });

        if (outcome.status === 'blocked') {
          await fail(outcome.reason);
          return {
            status: 'blocked',
            artifactId: null,
            artifactKind: null,
            passed: null,
            approved: null,
            failures: [],
            needed: outcome.needed,
            reason: outcome.reason,
            commit: null,
          };
        }

        // Commit what the agent changed, so every step is a reviewable commit on the work branch.
        let commit: string | null = null;
        if (env.workspace && WRITES_FILES.includes(input.task)) {
          commit = await env.workspace.commitAll(
            `${ticket!.key}: ${def.title}${attempt > 1 ? ` (attempt ${attempt})` : ''}`,
          );
        }

        const content = outcome.output as Record<string, unknown>;
        const facts = factsOf(outcome.kind, content);
        const artifactId = await db.transaction(async (tx) => {
          const [latest] = await tx
            .select({ v: artifacts.version })
            .from(artifacts)
            .where(and(eq(artifacts.runId, run.id), eq(artifacts.kind, outcome.kind)))
            .orderBy(desc(artifacts.version))
            .limit(1);
          const version = (latest?.v ?? 0) + 1;
          const [a] = await tx
            .insert(artifacts)
            .values({
              runId: run.id,
              ticketId: run.ticketId,
              stepId: step.id,
              kind: outcome.kind,
              title: `${ARTIFACT_LABELS[outcome.kind]}${version > 1 ? ` v${version}` : ''}`,
              content: commit ? { ...content, commit } : content,
              agentKey: def.agent,
              version,
            })
            .returning({ id: artifacts.id });
          await tx
            .update(runSteps)
            .set({
              status: 'succeeded',
              progress: 1,
              finishedAt: new Date(),
              currentAction: null,
              artifactId: a!.id,
            })
            .where(eq(runSteps.id, step.id));
          await appendActivity(tx, {
            projectId: run.projectId,
            ticketId: run.ticketId,
            runId: run.id,
            actorType: 'agent',
            agentKey: def.agent,
            type: 'artifact.created',
            summary: `${AGENTS[def.agent].name}: ${facts.headline}`,
            data: {
              stepId: step.id,
              artifactId: a!.id,
              kind: outcome.kind,
              version,
              commit,
              turns: outcome.turns,
              toolCalls: outcome.toolCalls,
            },
          });
          if (outcome.kind === 'test_results') {
            await appendActivity(tx, {
              projectId: run.projectId,
              ticketId: run.ticketId,
              runId: run.id,
              actorType: 'agent',
              agentKey: 'qa',
              type: facts.passed ? 'qa.passed' : 'qa.failed',
              summary: facts.passed
                ? 'All automated tests passed'
                : `Tests failed: ${facts.failures.slice(0, 3).join('; ')}`,
              data: { artifactId: a!.id },
            });
          }
          await publish(tx, {
            type: 'step.changed',
            projectId: run.projectId,
            ticketId: run.ticketId,
            runId: run.id,
            stepId: step.id,
          });
          return a!.id;
        });
        return {
          status: 'completed',
          artifactId,
          artifactKind: outcome.kind,
          passed: facts.passed,
          approved: facts.approved,
          failures: facts.failures,
          needed: null,
          reason: null,
          commit,
        };
      } catch (err) {
        if (signal.aborted) {
          await fail('Cancelled');
          throw err;
        }
        if (err instanceof LlmError) {
          await fail(err.message);
          if (!err.retryable) throw ApplicationFailure.nonRetryable(err.message, `Llm_${err.code}`);
          throw ApplicationFailure.retryable(err.message, `Llm_${err.code}`);
        }
        const message = (err as Error).message ?? String(err);
        await fail(message);
        throw ApplicationFailure.retryable(message, 'StepError');
      } finally {
        clearInterval(beat);
      }
    },
  };
}

/** Facts the workflow needs, plus a one-line headline for the timeline. */
function factsOf(
  kind: ArtifactKind,
  c: Record<string, unknown>,
): { headline: string; passed: boolean | null; approved: boolean | null; failures: string[] } {
  const base = { passed: null, approved: null, failures: [] as string[] };
  switch (kind) {
    case 'requirement_spec':
      return {
        ...base,
        headline: `requirements ready with ${(c.acceptanceCriteria as unknown[]).length} acceptance criteria`,
      };
    case 'impact_map': {
      const comps = c.components as { name: string; changeType: string }[];
      return {
        ...base,
        headline: `impact map: ${
          comps
            .filter((x) => x.changeType !== 'none')
            .map((x) => x.name)
            .slice(0, 6)
            .join(', ') || 'no components'
        }`,
      };
    }
    case 'change_plan':
      return {
        ...base,
        headline: `plan ready: ${(c.changes as unknown[]).length} change(s), ${String(c.complexity)} complexity`,
      };
    case 'test_plan':
      return { ...base, headline: `test plan with ${(c.cases as unknown[]).length} test case(s)` };
    case 'code_change':
      return {
        ...base,
        headline: `${(c.files as unknown[]).length} file(s) changed${c.compiled ? ', compiled' : ', NOT compiled'}`,
      };
    case 'db_change':
      return {
        ...base,
        headline: c.needed
          ? `${(c.scripts as unknown[]).length} database script(s)${c.rollbackVerified ? ', rollback verified' : ''}`
          : 'no database change needed',
      };
    case 'test_results': {
      const results = c.results as {
        caseId: string;
        title: string;
        status: string;
        details: string;
        failureCategory: string | null;
      }[];
      const failures = results
        .filter((r) => r.status === 'failed')
        .map((r) => `${r.caseId} ${r.title} [${r.failureCategory ?? 'unclassified'}]: ${r.details}`);
      const passed = Boolean(c.passed) && failures.length === 0;
      const n = results.filter((r) => r.status === 'passed').length;
      return {
        headline: `${n} of ${results.filter((r) => r.status !== 'skipped').length} tests passed`,
        passed,
        approved: null,
        failures,
      };
    }
    case 'review_report':
    case 'security_report': {
      const findings = (
        c.findings as {
          severity: string;
          file: string | null;
          line: number | null;
          issue: string;
          recommendation: string;
        }[]
      ).filter((f) => f.severity === 'blocker' || f.severity === 'major');
      return {
        headline: c.approved
          ? `${kind === 'review_report' ? 'review' : 'security check'} approved`
          : `${findings.length} blocking finding(s)`,
        passed: null,
        approved: Boolean(c.approved) && findings.length === 0,
        failures: findings.map(
          (f) =>
            `[${f.severity}] ${f.file ?? ''}${f.line ? `:${f.line}` : ''} ${f.issue} → ${f.recommendation}`,
        ),
      };
    }
    case 'release_package':
      return { ...base, headline: `release package for branch ${String(c.branch)}` };
    case 'release_notes':
      return { ...base, headline: `release notes: ${String(c.title)}` };
    case 'analysis_report':
      return { ...base, headline: `analysis report: ${String(c.title)}` };
    default:
      return { ...base, headline: 'business context recorded' };
  }
}
