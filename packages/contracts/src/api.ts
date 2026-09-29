import { z } from 'zod';
import {
  type ActorType,
  type AgentKey,
  type ArtifactKind,
  CredentialKind,
  type GateKind,
  type GateStatus,
  ProjectRole,
  type RunStatus,
  type SourceKind,
  type SourceStatus,
  type StageKey,
  type StepStatus,
  TicketPriority,
  type TicketSource,
  TicketStatus,
  TicketType,
  WorkflowType,
} from './enums.js';
import { ProjectSettings, ProjectSettingsPatch } from './settings.js';
import type { AgentTask } from './workflows.js';

/* ------------------------------------------------------------------ auth */

export const LoginRequest = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export interface UserDto {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  status: 'active' | 'disabled';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface MeDto extends UserDto {
  memberships: { projectId: string; projectKey: string; projectName: string; role: ProjectRole }[];
}

export const CreateUserRequest = z.object({
  email: z.email().max(200),
  name: z.string().min(1).max(120),
  password: z.string().min(10).max(200),
  isAdmin: z.boolean().default(false),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const UpdateUserRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  isAdmin: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: z.string().min(10).max(200).optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

/* -------------------------------------------------------------- projects */

export const ProjectKey = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use 2–10 capital letters or digits, starting with a letter');

export const CreateProjectRequest = z.object({
  key: ProjectKey,
  name: z.string().min(2).max(120),
  description: z.string().max(2000).default(''),
  clientName: z.string().max(120).default(''),
  techStack: z.array(z.string().min(1).max(40)).max(20).default([]),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  clientName: z.string().max(120).optional(),
  techStack: z.array(z.string().min(1).max(40)).max(20).optional(),
  settings: ProjectSettingsPatch.optional(),
  archived: z.boolean().optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

export interface ProjectDto {
  id: string;
  key: string;
  name: string;
  description: string;
  clientName: string;
  techStack: string[];
  settings: ProjectSettings;
  archived: boolean;
  createdAt: string;
  myRole: ProjectRole | null;
  counts: { open: number; needsApproval: number; blocked: number; activeRuns: number };
}

export const AddMemberRequest = z.object({ userId: z.uuid(), role: ProjectRole });
export type AddMemberRequest = z.infer<typeof AddMemberRequest>;
export const UpdateMemberRequest = z.object({ role: ProjectRole });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  addedAt: string;
}

/* --------------------------------------------------------------- tickets */

export const AcceptanceCriterion = z.object({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(2000),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const CreateTicketRequest = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(3).max(160),
  description: z.string().max(20000).default(''),
  type: TicketType.optional(),
  priority: TicketPriority.optional(),
  assigneeId: z.uuid().nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  dueDate: z.iso.date().nullable().optional(),
  acceptanceCriteria: z.array(AcceptanceCriterion).max(50).default([]),
  parentId: z.uuid().nullable().optional(),
  status: z.enum(['backlog', 'ready']).default('backlog'),
  /** Start a run as soon as the ticket is created. */
  startRun: z.boolean().default(false),
});
export type CreateTicketRequest = z.infer<typeof CreateTicketRequest>;

/** Free-text intake: Home prompt and external systems. Title and type are derived by triage. */
export const IntakeRequest = z.object({
  projectId: z.uuid(),
  text: z.string().trim().min(5).max(20000),
  startRun: z.boolean().default(false),
});
export type IntakeRequest = z.infer<typeof IntakeRequest>;

/** Intake from an external system authenticated by a project intake token. */
export const ExternalIntakeRequest = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  text: z.string().trim().min(5).max(20000),
  type: TicketType.optional(),
  priority: TicketPriority.optional(),
  externalRef: z.string().max(200).optional(),
  reporterEmail: z.email().optional(),
});
export type ExternalIntakeRequest = z.infer<typeof ExternalIntakeRequest>;

export const UpdateTicketRequest = z.object({
  version: z.number().int().nonnegative(),
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().max(20000).optional(),
  type: TicketType.optional(),
  priority: TicketPriority.optional(),
  assigneeId: z.uuid().nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  dueDate: z.iso.date().nullable().optional(),
  acceptanceCriteria: z.array(AcceptanceCriterion).max(50).optional(),
});
export type UpdateTicketRequest = z.infer<typeof UpdateTicketRequest>;

export const MoveTicketRequest = z.object({
  status: TicketStatus,
  /** Id of the ticket this one should sit after in the target column; null puts it first. */
  afterId: z.uuid().nullable().optional(),
  version: z.number().int().nonnegative(),
});
export type MoveTicketRequest = z.infer<typeof MoveTicketRequest>;

export const TicketListQuery = z.object({
  projectId: z.uuid().optional(),
  status: z.array(TicketStatus).optional(),
  type: z.array(TicketType).optional(),
  priority: z.array(TicketPriority).optional(),
  assigneeId: z.string().optional(),
  label: z.string().optional(),
  q: z.string().max(200).optional(),
  mine: z.coerce.boolean().optional(),
  includeCancelled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;

export interface UserRefDto {
  id: string;
  name: string;
  email: string;
}

export interface TicketSummaryDto {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  labels: string[];
  assignee: UserRefDto | null;
  reporter: UserRefDto | null;
  dueDate: string | null;
  source: TicketSource;
  rank: number;
  version: number;
  parentKey: string | null;
  activeRun: { id: string; status: RunStatus; stage: StageKey | null; workflowType: WorkflowType } | null;
  pendingGate: GateKind | null;
  commentCount: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDto extends TicketSummaryDto {
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
  externalRef: string | null;
  parent: { id: string; key: string; title: string; status: TicketStatus } | null;
  children: { id: string; key: string; title: string; status: TicketStatus; type: TicketType }[];
  duplicateOf: { id: string; key: string; title: string } | null;
  triage: { state: 'pending' | 'done' | 'skipped' | 'failed'; note: string | null };
  runs: RunSummaryDto[];
  closedAt: string | null;
}

export const CreateCommentRequest = z.object({ body: z.string().trim().min(1).max(20000) });
export type CreateCommentRequest = z.infer<typeof CreateCommentRequest>;

export interface CommentDto {
  id: string;
  ticketId: string;
  authorType: ActorType;
  author: UserRefDto | null;
  agentKey: AgentKey | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export interface ActivityDto {
  id: string;
  /** Position in the workspace-wide audit chain. */
  seq: number;
  /** SHA-256 over this entry and the previous entry's hash. */
  hash: string;
  projectId: string;
  ticketId: string | null;
  ticketKey: string | null;
  runId: string | null;
  actorType: ActorType;
  actor: UserRefDto | null;
  agentKey: AgentKey | null;
  type: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

/* ------------------------------------------------------------------ runs */

export const StartRunRequest = z.object({
  ticketId: z.uuid(),
  workflowType: WorkflowType.optional(),
});
export type StartRunRequest = z.infer<typeof StartRunRequest>;

export const RunControlRequest = z.object({
  action: z.enum(['pause', 'resume', 'cancel', 'retry']),
  note: z.string().max(2000).optional(),
});
export type RunControlRequest = z.infer<typeof RunControlRequest>;

export interface RunSummaryDto {
  id: string;
  ticketId: string;
  ticketKey: string;
  projectId: string;
  workflowType: WorkflowType;
  status: RunStatus;
  currentStage: StageKey | null;
  startedBy: UserRefDto | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  costUsd: number;
  budgetUsd: number;
}

export interface RunStepDto {
  id: string;
  stage: StageKey;
  task: AgentTask;
  agentKey: AgentKey;
  title: string;
  status: StepStatus;
  attempt: number;
  progress: number;
  currentAction: string | null;
  error: string | null;
  artifactId: string | null;
  costUsd: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface GateDto {
  id: string;
  runId: string;
  ticketId: string;
  ticketKey: string;
  ticketTitle: string;
  projectId: string;
  projectKey: string;
  kind: GateKind;
  status: GateStatus;
  summary: GateSummary;
  requestedAt: string;
  decidedBy: UserRefDto | null;
  decidedAt: string | null;
  note: string | null;
  canDecide: boolean;
  cannotDecideReason: string | null;
}

export interface GateSummary {
  headline: string;
  points: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }[];
  artifactIds: string[];
  /** Plain-language reason, for escalation gates. */
  reason?: string;
}

export const DecideGateRequest = z.object({
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  note: z.string().trim().max(4000).optional(),
});
export type DecideGateRequest = z.infer<typeof DecideGateRequest>;

export interface RunDetailDto extends RunSummaryDto {
  ticketTitle: string;
  steps: RunStepDto[];
  gates: GateDto[];
  artifacts: ArtifactSummaryDto[];
  planRevisions: number;
  qaAttempts: number;
  branch: string | null;
  tokens: { input: number; output: number };
}

export interface ArtifactSummaryDto {
  id: string;
  kind: ArtifactKind;
  title: string;
  agentKey: AgentKey | null;
  version: number;
  createdAt: string;
}

export interface ArtifactDto extends ArtifactSummaryDto {
  runId: string;
  ticketId: string;
  content: unknown;
}

/* ------------------------------------------------------------- knowledge */

export const CreateSourceRequest = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('git'),
    name: z.string().min(2).max(80),
    url: z.string().min(4).max(500),
    branch: z.string().min(1).max(200).default('main'),
    credentialId: z.uuid().nullable().default(null),
    includeGlobs: z.array(z.string()).default([]),
    excludeGlobs: z.array(z.string()).default(['**/node_modules/**', '**/.git/**']),
  }),
  z.object({
    kind: z.literal('oracle_metadata'),
    name: z.string().min(2).max(80),
    connectString: z.string().min(3).max(500),
    schemas: z.array(z.string().min(1).max(128)).min(1),
    credentialId: z.uuid(),
  }),
]);
export type CreateSourceRequest = z.infer<typeof CreateSourceRequest>;

export interface SourceDto {
  id: string;
  projectId: string;
  kind: SourceKind;
  name: string;
  config: Record<string, unknown>;
  status: SourceStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  stats: { objects: number; edges: number; chunks: number };
}

export const KnowledgeSearchQuery = z.object({
  projectId: z.uuid(),
  q: z.string().trim().min(1).max(500),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type KnowledgeSearchQuery = z.infer<typeof KnowledgeSearchQuery>;

export interface CodeObjectDto {
  id: string;
  kind: string;
  name: string;
  path: string | null;
  language: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
}

export interface SearchHitDto {
  object: CodeObjectDto;
  snippet: string;
  score: number;
}

export interface ObjectGraphDto {
  root: CodeObjectDto;
  nodes: CodeObjectDto[];
  edges: { from: string; to: string; kind: string }[];
}

export const AskRequest = z.object({
  projectId: z.uuid(),
  question: z.string().trim().min(3).max(4000),
});
export type AskRequest = z.infer<typeof AskRequest>;

export interface AskAnswerDto {
  answer: string;
  citations: { objectId: string; name: string; path: string | null }[];
}

/* ----------------------------------------------------------- credentials */

export const CreateCredentialRequest = z.object({
  name: z.string().min(2).max(80),
  kind: CredentialKind,
  /** Git token, API key, or JSON {"user","password"} for Oracle. Never returned by the API. */
  secret: z.string().min(1).max(10000),
});
export type CreateCredentialRequest = z.infer<typeof CreateCredentialRequest>;

export interface CredentialDto {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/* --------------------------------------------------------- notifications */

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------- dashboard */

export interface DashboardDto {
  needsMe: GateDto[];
  myTickets: TicketSummaryDto[];
  activeRuns: RunSummaryDto[];
  blocked: TicketSummaryDto[];
  recent: ActivityDto[];
  totals: {
    open: number;
    inProgress: number;
    awaitingApproval: number;
    blocked: number;
    doneThisWeek: number;
  };
}

export interface WorkspaceStatusDto {
  llm: { configured: boolean; model: string; provider: string };
  embeddings: { provider: string; configured: boolean };
  temporal: { connected: boolean };
  oracleTooling: { forms: boolean; reports: boolean };
}

/* ---------------------------------------------------------------- errors */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export { ProjectSettings };
