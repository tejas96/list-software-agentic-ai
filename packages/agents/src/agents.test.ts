import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AGENTS, TASKS } from '@lsa/contracts';
import type { LlmCall, LlmGateway, LlmUsage } from './llm.js';
import { modelSchema } from './llm.js';
import { systemPrompt, taskMessage, type TaskContext } from './prompts.js';
import { runAgentTask } from './runner.js';
import { SkillRegistry } from './skills.js';
import type { KnowledgeAccess } from './tools.js';

const skills = new SkillRegistry();

const usage: LlmUsage = {
  model: 'test',
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.01,
};

/** A scripted model: each call returns the next list of content blocks. */
function scripted(turns: Anthropic.Beta.BetaContentBlock[][]): { llm: LlmGateway; calls: LlmCall[] } {
  const calls: LlmCall[] = [];
  let i = 0;
  const llm = {
    available: true,
    model: 'test',
    async call(req: LlmCall) {
      calls.push(structuredClone({ ...req, signal: undefined }));
      const content = turns[Math.min(i++, turns.length - 1)]!;
      const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
      return { message: { content, stop_reason: stop } as unknown as Anthropic.Beta.BetaMessage, usage };
    },
  } as unknown as LlmGateway;
  return { llm, calls };
}

const tool = (id: string, name: string, input: unknown) =>
  ({ type: 'tool_use', id, name, input }) as unknown as Anthropic.Beta.BetaContentBlock;

const knowledge: KnowledgeAccess = {
  search: async (q) => [
    {
      name: 'CUSTOMER_ACCOUNT',
      kind: 'oracle_form',
      path: 'forms/CUSTOMER_ACCOUNT_fmb.xml',
      summary: `match for ${q}`,
      snippet: '',
    },
  ],
  object: async () => null,
  dependencies: async () => [],
};

const context: TaskContext = {
  project: { key: 'BNK', name: 'Core Banking', clientName: '', techStack: ['Oracle Forms'] },
  ticket: {
    key: 'BNK-1',
    type: 'feature',
    priority: 'medium',
    title: 'Add address',
    description: 'Add a customer address field.',
    acceptanceCriteria: [],
  },
  artifacts: [],
  feedback: [],
  environment: {
    workspace: false,
    branch: null,
    oracleForms: false,
    oracleReports: false,
    sandboxDb: false,
    testCommand: null,
    buildCommand: null,
    allowedCommands: [],
  },
};

const validSpec = {
  title: 'Add customer address to account opening',
  summary: 'Capture the address.',
  type: 'feature',
  priority: 'medium',
  userStory: 'As a teller I want to record the address.',
  requirements: [{ id: 'R1', text: 'The form captures the address.' }],
  acceptanceCriteria: [
    { id: 'AC1', given: 'a new customer', when: 'the teller saves', then: 'the address is stored' },
  ],
  assumptions: [],
  openQuestions: [],
  outOfScope: [],
};

const baseOpts = (llm: LlmGateway) => ({
  task: 'structure_requirement' as const,
  context,
  tools: { workspace: null, oracle: null, knowledge, progress: async () => undefined },
  llm,
  skills,
});

describe('skills', () => {
  it('loads every skill referenced by an agent', () => {
    for (const a of Object.values(AGENTS)) {
      for (const s of a.skills) expect(skills.get(s), `${a.key} → ${s}`).toBeDefined();
    }
    expect(skills.list().length).toBeGreaterThanOrEqual(15);
  });

  it('builds a system prompt with the agent role, skills and task', () => {
    const p = systemPrompt('legacy_intelligence', 'impact_analysis', skills);
    expect(p).toContain('Legacy Intelligence');
    expect(p).toContain('- impact-analysis:');
    expect(p).toContain(TASKS.impact_analysis.title);
    expect(taskMessage(context)).toContain('<ticket key="BNK-1"');
  });
});

describe('runAgentTask', () => {
  it('runs tools, rejects an invalid result, then accepts a valid one', async () => {
    const progress: string[] = [];
    const { llm, calls } = scripted([
      [
        tool('t1', 'load_skill', { name: 'requirements-engineering' }),
        tool('t2', 'knowledge_search', { query: 'account opening' }),
      ],
      [tool('t3', 'submit_result', { title: 'x' })],
      [tool('t4', 'submit_result', validSpec)],
    ]);
    const out = await runAgentTask({
      ...baseOpts(llm),
      tools: { ...baseOpts(llm).tools, progress: async (a) => void progress.push(a) },
      onUsage: async () => true,
    });
    expect(out.status).toBe('completed');
    expect(out.status === 'completed' && (out.output as { title: string }).title).toBe(validSpec.title);
    expect(progress).toEqual([
      'Loading the requirements-engineering skill',
      'Searching the knowledge graph for “account opening”',
    ]);
    // The invalid submission was returned to the model as an error with the fields to fix.
    const third = calls[2]!.messages.at(-1)!;
    const res = (third.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]!;
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toContain('does not match the schema');
  });

  it('records a blocker', async () => {
    const { llm } = scripted([
      [tool('b', 'report_blocker', { reason: 'No repository connected', needed: 'Connect the Git source' })],
    ]);
    const out = await runAgentTask({ ...baseOpts(llm), onUsage: async () => true });
    expect(out).toMatchObject({ status: 'blocked', reason: 'No repository connected' });
  });

  it('stops when the budget callback says so', async () => {
    const { llm } = scripted([[tool('k', 'knowledge_search', { query: 'x' })]]);
    const out = await runAgentTask({ ...baseOpts(llm), onUsage: async () => false });
    expect(out).toMatchObject({ status: 'blocked', reason: 'The run reached its spending limit.' });
  });

  it('refuses tools outside the agent groups', async () => {
    const { llm, calls } = scripted([
      [tool('w', 'write_file', { path: 'x', content: 'y' })],
      [tool('s', 'submit_result', validSpec)],
    ]);
    const out = await runAgentTask({ ...baseOpts(llm), onUsage: async () => true });
    expect(out.status).toBe('completed');
    const res = (calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]!;
    expect(res).toMatchObject({ is_error: true, content: 'Unknown tool write_file' });
    expect(calls[0]!.tools!.map((t) => t.name)).not.toContain('write_file');
  });

  it('gives up after repeated turns without tool calls', async () => {
    const text = { type: 'text', text: 'Thinking out loud' } as unknown as Anthropic.Beta.BetaContentBlock;
    const { llm } = scripted([[text]]);
    const out = await runAgentTask({ ...baseOpts(llm), onUsage: async () => true });
    expect(out).toMatchObject({
      status: 'blocked',
      reason: 'The agent stopped without submitting a result.',
    });
  });
});

describe('modelSchema', () => {
  it('closes objects and drops unsupported keywords', () => {
    const s = modelSchema({
      type: 'object',
      properties: {
        a: { type: 'string', minLength: 3 },
        b: { type: 'object', properties: { c: { type: 'number', minimum: 1 } } },
      },
    });
    expect(s).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: {
          type: 'object',
          properties: { c: { type: 'number' } },
          additionalProperties: false,
          required: ['c'],
        },
      },
      additionalProperties: false,
      required: ['a', 'b'],
    });
  });
});
