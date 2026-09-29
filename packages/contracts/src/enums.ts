import { z } from 'zod';

/** Role of a user inside one project. Ordered from least to most privileged. */
export const PROJECT_ROLES = ['viewer', 'requester', 'approver', 'admin'] as const;
export const ProjectRole = z.enum(PROJECT_ROLES);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const TICKET_TYPES = ['feature', 'bug', 'hotfix', 'analysis', 'task'] as const;
export const TicketType = z.enum(TICKET_TYPES);
export type TicketType = z.infer<typeof TicketType>;

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const TicketPriority = z.enum(TICKET_PRIORITIES);
export type TicketPriority = z.infer<typeof TicketPriority>;

/**
 * Ticket lifecycle. Board columns are these statuses in this order.
 * `blocked` means the run needs a person (agent escalation, missing configuration).
 */
export const TICKET_STATUSES = [
  'backlog',
  'ready',
  'analysing',
  'awaiting_plan_approval',
  'building',
  'verifying',
  'awaiting_release_approval',
  'releasing',
  'done',
  'blocked',
  'cancelled',
] as const;
export const TicketStatus = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatus>;

/** Where a ticket came from. Every requirement is logged on the board, whatever the source. */
export const TICKET_SOURCES = ['board', 'home', 'intake_api', 'agent', 'comment'] as const;
export const TicketSource = z.enum(TICKET_SOURCES);
export type TicketSource = z.infer<typeof TicketSource>;

export const WORKFLOW_TYPES = ['full_change', 'hotfix', 'analysis'] as const;
export const WorkflowType = z.enum(WORKFLOW_TYPES);
export type WorkflowType = z.infer<typeof WorkflowType>;

export const RUN_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'paused',
  'blocked',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled'];

export const STEP_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'skipped'] as const;
export const StepStatus = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatus>;

export const GATE_KINDS = ['plan', 'release', 'escalation'] as const;
export const GateKind = z.enum(GATE_KINDS);
export type GateKind = z.infer<typeof GateKind>;

export const GATE_STATUSES = ['pending', 'approved', 'changes_requested', 'rejected', 'cancelled'] as const;
export const GateStatus = z.enum(GATE_STATUSES);
export type GateStatus = z.infer<typeof GateStatus>;

export const STAGE_KEYS = ['understand', 'analyse', 'plan', 'build', 'verify', 'release'] as const;
export const StageKey = z.enum(STAGE_KEYS);
export type StageKey = z.infer<typeof StageKey>;

export const AGENT_KEYS = [
  'requirement_analyst',
  'business_analyst',
  'legacy_intelligence',
  'solution_architect',
  'developer',
  'database',
  'qa',
  'code_review',
  'security',
  'release',
  'documentation',
] as const;
export const AgentKey = z.enum(AGENT_KEYS);
export type AgentKey = z.infer<typeof AgentKey>;

export const ARTIFACT_KINDS = [
  'requirement_spec',
  'business_context',
  'impact_map',
  'change_plan',
  'test_plan',
  'code_change',
  'db_change',
  'test_results',
  'review_report',
  'security_report',
  'release_package',
  'release_notes',
  'analysis_report',
] as const;
export const ArtifactKind = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export const ActorType = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorType>;

export const SOURCE_KINDS = ['git', 'oracle_metadata'] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const SOURCE_STATUSES = ['idle', 'syncing', 'ready', 'error'] as const;
export const SourceStatus = z.enum(SOURCE_STATUSES);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const CODE_OBJECT_KINDS = [
  'oracle_form',
  'oracle_report',
  'plsql_package',
  'plsql_procedure',
  'plsql_function',
  'plsql_trigger',
  'db_table',
  'db_view',
  'db_sequence',
  'form_block',
  'form_trigger',
  'file',
  'class',
  'function',
  'module',
] as const;
export const CodeObjectKind = z.enum(CODE_OBJECT_KINDS);
export type CodeObjectKind = z.infer<typeof CodeObjectKind>;

export const EDGE_KINDS = ['contains', 'calls', 'reads', 'writes', 'references', 'imports'] as const;
export const EdgeKind = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKind>;

export const CREDENTIAL_KINDS = ['git_token', 'oracle_db', 'api_key'] as const;
export const CredentialKind = z.enum(CREDENTIAL_KINDS);
export type CredentialKind = z.infer<typeof CredentialKind>;
