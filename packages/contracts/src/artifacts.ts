import { z } from 'zod';
import type { ArtifactKind } from './enums.js';
import { TicketPriority, TicketType } from './enums.js';

/*
 * Typed outputs of agent tasks. Each schema is also sent to the model as the
 * `submit_result` tool schema, so every field is required (nullable when optional).
 */

const Id = z.string().min(1).max(40);

export const RequirementSpec = z.object({
  title: z.string().min(3).max(160),
  summary: z.string(),
  type: TicketType,
  priority: TicketPriority,
  userStory: z.string(),
  requirements: z.array(z.object({ id: Id, text: z.string() })),
  acceptanceCriteria: z.array(z.object({ id: Id, given: z.string(), when: z.string(), then: z.string() })),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  outOfScope: z.array(z.string()),
});

export const BusinessContext = z.object({
  process: z.string(),
  affectedRoles: z.array(z.string()),
  businessRules: z.array(z.object({ id: Id, rule: z.string() })),
  risks: z.array(z.string()),
  regulatoryNotes: z.array(z.string()),
});

export const ImpactMap = z.object({
  summary: z.string(),
  components: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      path: z.string().nullable(),
      reason: z.string(),
      changeType: z.enum(['modify', 'add', 'verify', 'none']),
    }),
  ),
  dependencies: z.array(z.object({ from: z.string(), to: z.string(), relation: z.string() })),
  rootCause: z.string().nullable(),
  risks: z.array(z.string()),
  evidence: z.array(z.object({ component: z.string(), finding: z.string() })),
});

export const ChangePlan = z.object({
  summary: z.string(),
  changes: z.array(
    z.object({
      id: Id,
      component: z.string(),
      kind: z.string(),
      description: z.string(),
      owner: z.enum(['developer', 'database']),
      order: z.number().int(),
    }),
  ),
  testsByChange: z.array(z.object({ changeId: Id, testIds: z.array(Id) })),
  rollback: z.string(),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string() })),
  complexity: z.enum(['low', 'medium', 'high']),
  notes: z.string(),
});

export const TestPlan = z.object({
  strategy: z.string(),
  cases: z.array(
    z.object({
      id: Id,
      title: z.string(),
      criterionId: z.string().nullable(),
      type: z.enum(['unit', 'integration', 'regression', 'reproduction', 'manual']),
      steps: z.array(z.string()),
      expected: z.string(),
      automated: z.boolean(),
      file: z.string().nullable(),
    }),
  ),
});

export const CodeChange = z.object({
  summary: z.string(),
  files: z.array(
    z.object({ path: z.string(), action: z.enum(['added', 'modified', 'deleted']), description: z.string() }),
  ),
  compiled: z.boolean(),
  compileLog: z.string().nullable(),
  notes: z.array(z.string()),
});

export const DbChange = z.object({
  summary: z.string(),
  needed: z.boolean(),
  scripts: z.array(
    z.object({ path: z.string(), purpose: z.string(), kind: z.enum(['ddl', 'dml', 'plsql', 'rollback']) }),
  ),
  rollbackVerified: z.boolean(),
  notes: z.array(z.string()),
});

export const TestResults = z.object({
  summary: z.string(),
  passed: z.boolean(),
  results: z.array(
    z.object({
      caseId: Id,
      title: z.string(),
      status: z.enum(['passed', 'failed', 'skipped', 'blocked']),
      details: z.string(),
      failureCategory: z.enum(['product_defect', 'test_defect', 'environment']).nullable(),
    }),
  ),
  command: z.string().nullable(),
  log: z.string().nullable(),
});

const Finding = z.object({
  severity: z.enum(['blocker', 'major', 'minor', 'info']),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  issue: z.string(),
  recommendation: z.string(),
});

export const ReviewReport = z.object({
  summary: z.string(),
  approved: z.boolean(),
  findings: z.array(Finding),
});

export const SecurityReport = z.object({
  summary: z.string(),
  approved: z.boolean(),
  checks: z.array(z.object({ check: z.string(), result: z.enum(['pass', 'fail', 'not_applicable']), notes: z.string() })),
  findings: z.array(Finding),
});

export const ReleasePackage = z.object({
  summary: z.string(),
  branch: z.string(),
  deploymentOrder: z.array(z.object({ step: z.number().int(), item: z.string(), notes: z.string() })),
  rollbackPlan: z.string(),
  manifest: z.array(z.object({ path: z.string(), kind: z.string() })),
});

export const ReleaseNotes = z.object({
  title: z.string(),
  audience: z.string(),
  markdown: z.string(),
});

export const AnalysisReport = z.object({
  title: z.string(),
  markdown: z.string(),
  recommendations: z.array(z.string()),
});

export const ARTIFACT_SCHEMAS = {
  requirement_spec: RequirementSpec,
  business_context: BusinessContext,
  impact_map: ImpactMap,
  change_plan: ChangePlan,
  test_plan: TestPlan,
  code_change: CodeChange,
  db_change: DbChange,
  test_results: TestResults,
  review_report: ReviewReport,
  security_report: SecurityReport,
  release_package: ReleasePackage,
  release_notes: ReleaseNotes,
  analysis_report: AnalysisReport,
} as const satisfies Record<ArtifactKind, z.ZodType>;

export type ArtifactContent<K extends ArtifactKind> = z.infer<(typeof ARTIFACT_SCHEMAS)[K]>;

export const ARTIFACT_LABELS: Record<ArtifactKind, string> = {
  requirement_spec: 'Requirement spec',
  business_context: 'Business context',
  impact_map: 'Impact map',
  change_plan: 'Change plan',
  test_plan: 'Test plan',
  code_change: 'Code changes',
  db_change: 'Database changes',
  test_results: 'Test results',
  review_report: 'Code review',
  security_report: 'Security report',
  release_package: 'Release package',
  release_notes: 'Release notes',
  analysis_report: 'Analysis report',
};

/** Triage result for a new ticket (classification, draft criteria, duplicate check). */
export const TriageResult = z.object({
  title: z.string().min(3).max(160),
  type: TicketType,
  priority: TicketPriority,
  summary: z.string(),
  acceptanceCriteria: z.array(z.string()),
  labels: z.array(z.string()),
  duplicateOfKey: z.string().nullable(),
  duplicateReason: z.string().nullable(),
});
export type TriageResult = z.infer<typeof TriageResult>;
