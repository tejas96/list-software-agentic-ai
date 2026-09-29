import { z } from 'zod';
import { TicketType, WorkflowType } from './enums.js';
import { DEFAULT_WORKFLOW_BY_TYPE } from './lifecycle.js';

/** Per-project configuration. Every field has a safe default, so older rows keep working. */
export const ProjectSettings = z.object({
  /** Start a run automatically when a ticket is moved to Ready. */
  autoStartOnReady: z.boolean().default(false),
  /** Run triage (classification, acceptance criteria draft, duplicate check) on every new ticket. */
  autoTriage: z.boolean().default(true),
  workflowByType: z.record(TicketType, WorkflowType).default({ ...DEFAULT_WORKFLOW_BY_TYPE }),
  gates: z
    .object({ plan: z.boolean().default(true), release: z.boolean().default(true) })
    .default({ plan: true, release: true }),
  /** Approver must be a different person from the one who requested the change. */
  requireIndependentApprover: z.boolean().default(false),
  /** How many test-fix cycles the build stage may run before asking a person. */
  qaMaxAttempts: z.number().int().min(1).max(10).default(3),
  /** How many times a plan may be sent back before the run is blocked. */
  maxPlanRevisions: z.number().int().min(0).max(10).default(3),
  /** Hard spending limit per run in US dollars. The run stops for a person when reached. */
  runBudgetUsd: z.number().min(1).max(1000).default(25),
  /** Commands agents may run in the sandbox (prefix match on the executable). */
  allowedCommands: z
    .array(z.string().min(1))
    .default([
      'git',
      'ls',
      'cat',
      'grep',
      'find',
      'npm',
      'pnpm',
      'node',
      'sqlplus',
      'sql',
      'utplsql',
      'frmcmp_batch',
      'frmf2xml',
      'frmxml2f',
      'rwconverter',
    ]),
  /** Command used by QA to run the project's automated tests, if the repository has one. */
  testCommand: z.string().nullable().default(null),
  /** Command used to build or compile the project in the sandbox, if any. */
  buildCommand: z.string().nullable().default(null),
  /** Git branch new work branches start from. */
  baseBranch: z.string().default('main'),
  /** Knowledge source whose repository the agents work in. Defaults to the project's first Git source. */
  workSourceId: z.string().nullable().default(null),
  /**
   * Oracle schema the agents may change and test against. Never point this at production:
   * agents run DDL and PL/SQL here.
   */
  sandboxDb: z
    .object({ connectString: z.string().min(3), credentialId: z.string() })
    .nullable()
    .default(null),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

export const ProjectSettingsPatch = ProjectSettings.partial();
export type ProjectSettingsPatch = z.infer<typeof ProjectSettingsPatch>;

export function resolveProjectSettings(raw: unknown): ProjectSettings {
  const parsed = ProjectSettings.safeParse(raw ?? {});
  return parsed.success ? parsed.data : ProjectSettings.parse({});
}
