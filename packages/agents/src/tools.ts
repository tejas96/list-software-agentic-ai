import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ToolGroup } from '@lsa/contracts';
import { OracleUnavailableError, WorkspaceError, type OracleAdapter, type Workspace } from '@lsa/adapters';
import type { SkillRegistry } from './skills.js';

/** Read access to the project knowledge graph, implemented by the worker over Postgres. */
export interface KnowledgeAccess {
  search(
    query: string,
    kind?: string,
  ): Promise<{ name: string; kind: string; path: string | null; summary: string | null; snippet: string }[]>;
  object(
    name: string,
  ): Promise<{
    name: string;
    kind: string;
    path: string | null;
    summary: string | null;
    metadata: Record<string, unknown>;
    content: string;
  } | null>;
  dependencies(
    name: string,
    direction: 'uses' | 'used_by' | 'both',
    depth: number,
  ): Promise<{ from: string; fromKind: string; to: string; toKind: string; kind: string }[]>;
}

export interface ToolContext {
  workspace: Workspace | null;
  oracle: OracleAdapter | null;
  knowledge: KnowledgeAccess;
  skills: SkillRegistry;
  allowedSkills: string[];
  /** Short human-readable description of what the agent is doing now. Shown live in the UI. */
  progress(action: string): Promise<void>;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  group: ToolGroup | 'core';
  description: string;
  schema: S;
  /** Read-only tools may run in parallel. */
  readOnly: boolean;
  describe(input: z.infer<S>): string;
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}

const def = <S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> => t;

function needWorkspace(ctx: ToolContext): Workspace {
  if (!ctx.workspace)
    throw new WorkspaceError(
      'This task has no repository checked out. Work from the knowledge graph instead.',
    );
  return ctx.workspace;
}
function needOracle(ctx: ToolContext): OracleAdapter {
  if (!ctx.oracle) throw new OracleUnavailableError('The Oracle adapter is not configured for this project.');
  return ctx.oracle;
}

export const TOOLS: ToolDef[] = [
  def({
    name: 'knowledge_search',
    group: 'knowledge',
    description:
      'Search the project knowledge graph (forms, reports, packages, tables, files) by name or text. Use first to find real component names.',
    schema: z.object({
      query: z.string().min(1),
      kind: z.string().optional().describe('Filter by kind, e.g. oracle_form, plsql_package, db_table'),
    }),
    readOnly: true,
    describe: (i) => `Searching the knowledge graph for “${i.query}”`,
    run: (i, ctx) => ctx.knowledge.search(i.query, i.kind),
  }),
  def({
    name: 'knowledge_object',
    group: 'knowledge',
    description:
      'Get one object from the knowledge graph by exact name: summary, metadata (blocks, columns, members, reads, writes, calls) and source text.',
    schema: z.object({ name: z.string().min(1) }),
    readOnly: true,
    describe: (i) => `Reading ${i.name} from the knowledge graph`,
    run: async (i, ctx) =>
      (await ctx.knowledge.object(i.name)) ?? { error: `No object named ${i.name}. Use knowledge_search.` },
  }),
  def({
    name: 'knowledge_dependencies',
    group: 'knowledge',
    description:
      'List dependencies of an object. direction "uses" = what it reads/writes/calls; "used_by" = what depends on it; "both". Depth 1–3.',
    schema: z.object({
      name: z.string().min(1),
      direction: z.enum(['uses', 'used_by', 'both']),
      depth: z.number().int().min(1).max(3).default(1),
    }),
    readOnly: true,
    describe: (i) => `Tracing dependencies of ${i.name}`,
    run: (i, ctx) => ctx.knowledge.dependencies(i.name, i.direction, i.depth),
  }),
  def({
    name: 'list_files',
    group: 'workspace_read',
    description: 'List files in the checked-out repository. Optional glob such as "**/*.pkb" or "forms/**".',
    schema: z.object({ dir: z.string().default('.'), glob: z.string().optional() }),
    readOnly: true,
    describe: (i) => `Listing files${i.glob ? ` matching ${i.glob}` : ''}`,
    run: (i, ctx) => needWorkspace(ctx).listFiles(i.dir, i.glob),
  }),
  def({
    name: 'read_file',
    group: 'workspace_read',
    description:
      'Read a text file with line numbers. Use start_line/end_line for large files. Line numbers are not part of the file.',
    schema: z.object({
      path: z.string().min(1),
      start_line: z.number().int().min(1).optional(),
      end_line: z.number().int().min(1).optional(),
    }),
    readOnly: true,
    describe: (i) => `Reading ${i.path}`,
    run: (i, ctx) => needWorkspace(ctx).readFile(i.path, i.start_line, i.end_line),
  }),
  def({
    name: 'search_files',
    group: 'workspace_read',
    description:
      'Search file contents with a case-insensitive regular expression. Optional glob to limit files.',
    schema: z.object({ pattern: z.string().min(1), glob: z.string().optional() }),
    readOnly: true,
    describe: (i) => `Searching the code for /${i.pattern}/`,
    run: (i, ctx) => needWorkspace(ctx).searchFiles(i.pattern, i.glob),
  }),
  def({
    name: 'write_file',
    group: 'workspace_write',
    description:
      'Create a new file or fully replace a file you have read. Prefer edit_file for changes to existing files.',
    schema: z.object({ path: z.string().min(1), content: z.string() }),
    readOnly: false,
    describe: (i) => `Writing ${i.path}`,
    run: (i, ctx) => needWorkspace(ctx).writeFile(i.path, i.content),
  }),
  def({
    name: 'edit_file',
    group: 'workspace_write',
    description:
      'Replace one exact, unique block of text in a file you have read. Copy old_text exactly from the file (without line numbers). Include enough lines to be unique.',
    schema: z.object({ path: z.string().min(1), old_text: z.string().min(1), new_text: z.string() }),
    readOnly: false,
    describe: (i) => `Editing ${i.path}`,
    run: (i, ctx) => needWorkspace(ctx).editFile(i.path, i.old_text, i.new_text),
  }),
  def({
    name: 'delete_file',
    group: 'workspace_write',
    description: 'Delete a file. Only when the plan says so.',
    schema: z.object({ path: z.string().min(1) }),
    readOnly: false,
    describe: (i) => `Deleting ${i.path}`,
    run: async (i, ctx) => {
      await needWorkspace(ctx).deleteFile(i.path);
      return { deleted: i.path };
    },
  }),
  def({
    name: 'run_command',
    group: 'commands',
    description:
      'Run an allowed program in the repository (no shell: pipes, redirects and && do not work). Give the program name and an argument list.',
    schema: z.object({
      program: z.string().min(1),
      args: z.array(z.string()).default([]),
      timeout_seconds: z.number().int().min(5).max(1800).default(300),
    }),
    readOnly: false,
    describe: (i) => `Running ${[i.program, ...i.args].join(' ').slice(0, 120)}`,
    run: async (i, ctx) => {
      const r = await needWorkspace(ctx).run(i.program, i.args, i.timeout_seconds * 1000);
      return { exit_code: r.exitCode, timed_out: r.timedOut, stdout: r.stdout, stderr: r.stderr };
    },
  }),
  def({
    name: 'git_diff',
    group: 'git',
    description: 'Show all changes in the working tree compared with the last commit (stat and patch).',
    schema: z.object({}),
    readOnly: true,
    describe: () => 'Reviewing the diff',
    run: async (_i, ctx) => ({ diff: await needWorkspace(ctx).diff() }),
  }),
  def({
    name: 'oracle_form_to_xml',
    group: 'oracle',
    description: 'Convert an Oracle Forms module (.fmb) to editable XML (<NAME>_fmb.xml) with frmf2xml.',
    schema: z.object({ fmb_path: z.string().min(1) }),
    readOnly: false,
    describe: (i) => `Converting ${i.fmb_path} to XML`,
    run: (i, ctx) => needOracle(ctx).formToXml(needWorkspace(ctx), i.fmb_path),
  }),
  def({
    name: 'oracle_xml_to_form',
    group: 'oracle',
    description: 'Convert <NAME>_fmb.xml back to the .fmb module with frmxml2f.',
    schema: z.object({ xml_path: z.string().min(1) }),
    readOnly: false,
    describe: (i) => `Converting ${i.xml_path} back to a form module`,
    run: (i, ctx) => needOracle(ctx).xmlToForm(needWorkspace(ctx), i.xml_path),
  }),
  def({
    name: 'oracle_compile_form',
    group: 'oracle',
    description:
      'Compile a form (.fmb) against the sandbox schema with frmcmp_batch. Returns ok and the compiler log.',
    schema: z.object({ fmb_path: z.string().min(1) }),
    readOnly: false,
    describe: (i) => `Compiling ${i.fmb_path}`,
    run: (i, ctx) => needOracle(ctx).compileForm(needWorkspace(ctx), i.fmb_path),
  }),
  def({
    name: 'oracle_report_to_xml',
    group: 'oracle',
    description: 'Convert an Oracle Report (.rdf) to XML (<NAME>_rdf.xml) with rwconverter.',
    schema: z.object({ rdf_path: z.string().min(1) }),
    readOnly: false,
    describe: (i) => `Converting ${i.rdf_path} to XML`,
    run: (i, ctx) => needOracle(ctx).convertReport(needWorkspace(ctx), i.rdf_path, 'xml'),
  }),
  def({
    name: 'oracle_xml_to_report',
    group: 'oracle',
    description: 'Convert <NAME>_rdf.xml back to the .rdf report with rwconverter.',
    schema: z.object({ xml_path: z.string().min(1) }),
    readOnly: false,
    describe: (i) => `Converting ${i.xml_path} back to a report`,
    run: (i, ctx) => needOracle(ctx).convertReport(needWorkspace(ctx), i.xml_path, 'rdf'),
  }),
  def({
    name: 'oracle_run_sql',
    group: 'oracle',
    description:
      'Run one SQL statement or PL/SQL block against the project SANDBOX schema (never production). SELECT returns rows. Use for DDL, compiling packages, running tests and checking ALL_ERRORS.',
    schema: z.object({ statement: z.string().min(1) }),
    readOnly: false,
    describe: (i) => `Running SQL: ${i.statement.replace(/\s+/g, ' ').slice(0, 90)}`,
    run: (i, ctx) => needOracle(ctx).runSql(i.statement),
  }),
  def({
    name: 'oracle_describe',
    group: 'oracle',
    description: 'Describe a database object in the sandbox: type, status, columns and dependencies.',
    schema: z.object({ name: z.string().min(1), owner: z.string().optional() }),
    readOnly: true,
    describe: (i) => `Describing ${i.name} in the sandbox database`,
    run: (i, ctx) => needOracle(ctx).describe(i.owner ?? null, i.name),
  }),
  def({
    name: 'load_skill',
    group: 'core',
    description: 'Load the full instructions of one of your skills. Do this before work the skill covers.',
    schema: z.object({ name: z.string().min(1) }),
    readOnly: true,
    describe: (i) => `Loading the ${i.name} skill`,
    run: async (i, ctx) => {
      if (!ctx.allowedSkills.includes(i.name))
        return {
          error: `Skill ${i.name} is not available to you. Available: ${ctx.allowedSkills.join(', ')}`,
        };
      const s = ctx.skills.get(i.name);
      return s ? { name: s.name, instructions: s.body } : { error: `Skill ${i.name} was not found` };
    },
  }),
];

export const SUBMIT_TOOL = 'submit_result';
export const BLOCKER_TOOL = 'report_blocker';

/** Tool definitions for the model, filtered to the agent's groups, plus submit and blocker tools. */
export function toolsFor(
  groups: ToolGroup[],
  resultSchema: Record<string, unknown>,
): { defs: Anthropic.Beta.BetaTool[]; byName: Map<string, ToolDef> } {
  const allowed = TOOLS.filter((t) => t.group === 'core' || groups.includes(t.group as ToolGroup));
  const defs: Anthropic.Beta.BetaTool[] = allowed.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.schema, {
      io: 'input',
      unrepresentable: 'any',
    }) as Anthropic.Beta.BetaTool['input_schema'],
  }));
  defs.push({
    name: SUBMIT_TOOL,
    description:
      'Submit your final result for this task, exactly once, when the work is complete and verified. The input must match the schema. After this call your task ends.',
    input_schema: resultSchema as Anthropic.Beta.BetaTool['input_schema'],
  });
  defs.push({
    name: BLOCKER_TOOL,
    description:
      'Stop and ask a person for help when you cannot complete the task correctly: missing access or tooling, contradictory requirements, or a decision only a person can make. Explain exactly what is needed.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'What is blocking you, in plain language.' },
        needed: { type: 'string', description: 'What a person must do or decide to unblock you.' },
      },
      required: ['reason', 'needed'],
      additionalProperties: false,
    },
  });
  return { defs, byName: new Map(allowed.map((t) => [t.name, t])) };
}
