import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AGENTS, ARTIFACT_SCHEMAS, TASKS, type AgentTask, type ArtifactKind } from '@lsa/contracts';
import { OracleUnavailableError, WorkspaceError } from '@lsa/adapters';
import { LlmError, modelSchema, type Effort, type LlmGateway, type LlmUsage } from './llm.js';
import { systemPrompt, taskMessage, type TaskContext } from './prompts.js';
import type { SkillRegistry } from './skills.js';
import { BLOCKER_TOOL, SUBMIT_TOOL, toolsFor, type ToolContext } from './tools.js';

export interface RunTaskOptions {
  task: AgentTask;
  context: TaskContext;
  tools: Omit<ToolContext, 'skills' | 'allowedSkills'>;
  llm: LlmGateway;
  skills: SkillRegistry;
  /** Called after every model turn with that turn's usage. Return false to stop (budget exhausted). */
  onUsage: (usage: LlmUsage) => Promise<boolean>;
  maxTurns?: number;
  effort?: Effort;
  signal?: AbortSignal;
}

export type TaskOutcome =
  | { status: 'completed'; kind: ArtifactKind; output: unknown; turns: number; toolCalls: number }
  | { status: 'blocked'; reason: string; needed: string; turns: number; toolCalls: number };

const MAX_TOOL_OUTPUT = 30_000;
const DEFAULT_TURNS: Partial<Record<AgentTask, number>> = {
  implement_change: 80,
  implement_db_change: 60,
  run_tests: 60,
  fix_failures: 60,
  impact_analysis: 50,
  root_cause_analysis: 50,
};
const EFFORT: Partial<Record<AgentTask, Effort>> = {
  business_context: 'medium',
  release_notes: 'medium',
  package_release: 'medium',
};

function truncate(text: string): string {
  return text.length > MAX_TOOL_OUTPUT
    ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…[truncated ${text.length - MAX_TOOL_OUTPUT} characters; narrow your request]`
    : text;
}

/**
 * Run one agent task to completion: a tool loop that ends when the agent
 * submits a result that validates against the task's artifact schema, or
 * reports a blocker. Invalid submissions are returned to the agent to fix.
 */
export async function runAgentTask(opts: RunTaskOptions): Promise<TaskOutcome> {
  const def = TASKS[opts.task];
  const agent = AGENTS[def.agent];
  const schema = ARTIFACT_SCHEMAS[def.produces] as z.ZodType;
  const resultSchema = modelSchema(
    z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
  );
  const { defs, byName } = toolsFor(agent.toolGroups, resultSchema);
  const ctx: ToolContext = { ...opts.tools, skills: opts.skills, allowedSkills: agent.skills };
  const system = systemPrompt(def.agent, opts.task, opts.skills);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: taskMessage(opts.context) }] },
  ];
  const maxTurns = opts.maxTurns ?? DEFAULT_TURNS[opts.task] ?? 40;
  let toolCalls = 0;
  let nudges = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (opts.signal?.aborted) throw new Error('Task cancelled');
    const { message, usage } = await opts.llm.call({
      system,
      messages,
      tools: defs,
      effort: opts.effort ?? EFFORT[opts.task] ?? 'high',
      pruneToolResults: true,
      signal: opts.signal,
    });
    const keepGoing = await opts.onUsage(usage);
    messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (message.stop_reason === 'max_tokens') {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Your last response was cut off by the output limit. Continue with smaller steps (for example edit files in parts).',
          },
        ],
      });
      continue;
    }

    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (uses.length === 0) {
      if (nudges++ >= 2) {
        return {
          status: 'blocked',
          reason: 'The agent stopped without submitting a result.',
          needed: 'Review the task inputs and retry the run.',
          turns: turn,
          toolCalls,
        };
      }
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Continue the task. When it is complete and verified, call ${SUBMIT_TOOL}; if you cannot complete it, call ${BLOCKER_TOOL}.`,
          },
        ],
      });
      continue;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    const state: { submitted: TaskOutcome | null } = { submitted: null };

    // Read-only tools run in parallel; everything else in order.
    const exec = async (
      u: Anthropic.Beta.BetaToolUseBlock,
    ): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
      toolCalls++;
      if (u.name === SUBMIT_TOOL) {
        const parsed = schema.safeParse(u.input);
        if (!parsed.success) {
          return {
            type: 'tool_result',
            tool_use_id: u.id,
            is_error: true,
            content: `The result does not match the schema. Fix these fields and submit again:\n${parsed.error.issues.map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`,
          };
        }
        state.submitted = {
          status: 'completed',
          kind: def.produces,
          output: parsed.data,
          turns: turn,
          toolCalls,
        };
        return { type: 'tool_result', tool_use_id: u.id, content: 'Result recorded.' };
      }
      if (u.name === BLOCKER_TOOL) {
        const b = z.object({ reason: z.string(), needed: z.string() }).safeParse(u.input);
        state.submitted = {
          status: 'blocked',
          reason: b.success ? b.data.reason : 'Unspecified blocker',
          needed: b.success ? b.data.needed : '',
          turns: turn,
          toolCalls,
        };
        return {
          type: 'tool_result',
          tool_use_id: u.id,
          content: 'Blocker recorded. A person will be asked.',
        };
      }
      const tool = byName.get(u.name);
      if (!tool)
        return { type: 'tool_result', tool_use_id: u.id, is_error: true, content: `Unknown tool ${u.name}` };
      const input = tool.schema.safeParse(u.input);
      if (!input.success) {
        return {
          type: 'tool_result',
          tool_use_id: u.id,
          is_error: true,
          content: `Invalid input: ${input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        };
      }
      try {
        await ctx.progress(tool.describe(input.data));
        const out = await tool.run(input.data, ctx);
        return {
          type: 'tool_result',
          tool_use_id: u.id,
          content: truncate(typeof out === 'string' ? out : JSON.stringify(out, null, 1)),
        };
      } catch (err) {
        const known = err instanceof WorkspaceError || err instanceof OracleUnavailableError;
        return {
          type: 'tool_result',
          tool_use_id: u.id,
          is_error: true,
          content: known ? (err as Error).message : `Tool failed: ${(err as Error).message}`,
        };
      }
    };

    const readOnly = uses.every((u) => byName.get(u.name)?.readOnly);
    if (readOnly) results.push(...(await Promise.all(uses.map(exec))));
    else for (const u of uses) results.push(await exec(u));

    messages.push({ role: 'user', content: results });
    if (state.submitted) return state.submitted;
    if (!keepGoing) {
      return {
        status: 'blocked',
        reason: 'The run reached its spending limit.',
        needed: 'Raise the project run budget or approve continuing.',
        turns: turn,
        toolCalls,
      };
    }
  }
  return {
    status: 'blocked',
    reason: `The agent used all ${maxTurns} turns without finishing.`,
    needed: 'Check whether the task is too large for one step, then retry.',
    turns: maxTurns,
    toolCalls,
  };
}

export { LlmError };
