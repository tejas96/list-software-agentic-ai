import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import {
  ACTOR_TYPES,
  AGENT_KEYS,
  ARTIFACT_KINDS,
  CREDENTIAL_KINDS,
  GATE_KINDS,
  GATE_STATUSES,
  PROJECT_ROLES,
  RUN_STATUSES,
  SOURCE_KINDS,
  SOURCE_STATUSES,
  STAGE_KEYS,
  STEP_STATUSES,
  TICKET_PRIORITIES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  TICKET_TYPES,
  WORKFLOW_TYPES,
  type AcceptanceCriterion,
  type GateSummary,
} from '@lsa/contracts';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ enums */

export const projectRole = pgEnum('project_role', PROJECT_ROLES);
export const ticketType = pgEnum('ticket_type', TICKET_TYPES);
export const ticketStatus = pgEnum('ticket_status', TICKET_STATUSES);
export const ticketPriority = pgEnum('ticket_priority', TICKET_PRIORITIES);
export const ticketSource = pgEnum('ticket_source', TICKET_SOURCES);
export const workflowType = pgEnum('workflow_type', WORKFLOW_TYPES);
export const runStatus = pgEnum('run_status', RUN_STATUSES);
export const stepStatus = pgEnum('step_status', STEP_STATUSES);
export const gateKind = pgEnum('gate_kind', GATE_KINDS);
export const gateStatus = pgEnum('gate_status', GATE_STATUSES);
export const stageKey = pgEnum('stage_key', STAGE_KEYS);
export const agentKey = pgEnum('agent_key', AGENT_KEYS);
export const artifactKind = pgEnum('artifact_kind', ARTIFACT_KINDS);
export const actorType = pgEnum('actor_type', ACTOR_TYPES);
export const sourceKind = pgEnum('source_kind', SOURCE_KINDS);
export const sourceStatus = pgEnum('source_status', SOURCE_STATUSES);
export const credentialKind = pgEnum('credential_kind', CREDENTIAL_KINDS);
export const triageState = pgEnum('triage_state', ['pending', 'done', 'skipped', 'failed']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);

/* ------------------------------------------------------------------ users */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    status: userStatus('status').notNull().default('active'),
    /** Incremented on password change or disable, invalidating existing sessions. */
    sessionVersion: integer('session_version').notNull().default(0),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

/* --------------------------------------------------------------- projects */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    clientName: text('client_name').notNull().default(''),
    techStack: jsonb('tech_stack').$type<string[]>().notNull().default([]),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** Next ticket number. Incremented atomically when a ticket is created. */
    ticketSeq: integer('ticket_seq').notNull().default(0),
    /** SHA-256 of the intake token. The token itself is shown once. */
    intakeTokenHash: text('intake_token_hash'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('projects_key_uq').on(t.key)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user_idx').on(t.userId)],
);

/* ---------------------------------------------------------------- tickets */

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    number: integer('number').notNull(),
    key: text('key').notNull(),
    type: ticketType('type').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    acceptanceCriteria: jsonb('acceptance_criteria').$type<AcceptanceCriterion[]>().notNull().default([]),
    status: ticketStatus('status').notNull().default('backlog'),
    priority: ticketPriority('priority').notNull().default('medium'),
    labels: text('labels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: ticketSource('source').notNull(),
    externalRef: text('external_ref'),
    reporterId: uuid('reporter_id').references(() => users.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    parentId: uuid('parent_id'),
    duplicateOfId: uuid('duplicate_of_id'),
    dueDate: text('due_date'),
    rank: doublePrecision('rank').notNull(),
    activeRunId: uuid('active_run_id'),
    triageState: triageState('triage_state').notNull().default('skipped'),
    triageNote: text('triage_note'),
    /** Optimistic concurrency: clients send the version they edited. */
    version: integer('version').notNull().default(0),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(key, '') || ' ' || coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    ),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tickets_key_uq').on(t.key),
    uniqueIndex('tickets_project_number_uq').on(t.projectId, t.number),
    index('tickets_board_idx').on(t.projectId, t.status, t.rank),
    index('tickets_assignee_idx').on(t.assigneeId),
    index('tickets_parent_idx').on(t.parentId),
    index('tickets_search_idx').using('gin', t.searchVector),
  ],
);

export const ticketComments = pgTable(
  'ticket_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorType: actorType('author_type').notNull(),
    authorId: uuid('author_id').references(() => users.id),
    agentKey: agentKey('agent_key'),
    body: text('body').notNull(),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [index('ticket_comments_ticket_idx').on(t.ticketId, t.createdAt)],
);

/* ------------------------------------------------------------- activities */

/**
 * Append-only audit trail and timeline. A database trigger rejects UPDATE and
 * DELETE. Each row carries the SHA-256 of the previous row, forming a chain
 * that can be verified end to end.
 */
export const activities = pgTable(
  'activities',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    id: uuid('id').notNull().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id),
    ticketId: uuid('ticket_id'),
    runId: uuid('run_id'),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    agentKey: agentKey('agent_key'),
    type: text('type').notNull(),
    summary: text('summary').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('activities_id_uq').on(t.id),
    index('activities_ticket_idx').on(t.ticketId, t.seq),
    index('activities_run_idx').on(t.runId, t.seq),
    index('activities_project_idx').on(t.projectId, t.seq),
    index('activities_actor_idx').on(t.actorId, t.seq),
  ],
);

/* ------------------------------------------------------------------- runs */

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    workflowType: workflowType('workflow_type').notNull(),
    status: runStatus('status').notNull().default('queued'),
    currentStage: stageKey('current_stage'),
    temporalWorkflowId: text('temporal_workflow_id').notNull(),
    /** Settings captured when the run started, so later edits don't change a running workflow. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    branch: text('branch'),
    planRevisions: integer('plan_revisions').notNull().default(0),
    qaAttempts: integer('qa_attempts').notNull().default(0),
    error: text('error'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
    tokensIn: bigint('tokens_in', { mode: 'number' }).notNull().default(0),
    tokensOut: bigint('tokens_out', { mode: 'number' }).notNull().default(0),
    startedById: uuid('started_by_id').references(() => users.id),
    startedAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('runs_ticket_idx').on(t.ticketId, t.startedAt),
    index('runs_status_idx').on(t.status),
    uniqueIndex('runs_workflow_uq').on(t.temporalWorkflowId),
  ],
);

export const runSteps = pgTable(
  'run_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stage: stageKey('stage').notNull(),
    task: text('task').notNull(),
    agentKey: agentKey('agent_key').notNull(),
    title: text('title').notNull(),
    status: stepStatus('status').notNull().default('pending'),
    attempt: integer('attempt').notNull().default(1),
    progress: doublePrecision('progress').notNull().default(0),
    currentAction: text('current_action'),
    error: text('error'),
    artifactId: uuid('artifact_id'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('run_steps_run_idx').on(t.runId, t.createdAt),
    uniqueIndex('run_steps_attempt_uq').on(t.runId, t.task, t.attempt),
  ],
);

export const gates = pgTable(
  'gates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    kind: gateKind('kind').notNull(),
    status: gateStatus('status').notNull().default('pending'),
    summary: jsonb('summary').$type<GateSummary>().notNull(),
    requestedAt: createdAt(),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
  },
  (t) => [index('gates_pending_idx').on(t.status, t.projectId), index('gates_run_idx').on(t.runId)],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    stepId: uuid('step_id'),
    kind: artifactKind('kind').notNull(),
    title: text('title').notNull(),
    content: jsonb('content').notNull(),
    agentKey: agentKey('agent_key'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    index('artifacts_run_idx').on(t.runId, t.kind, t.version),
    index('artifacts_ticket_idx').on(t.ticketId),
  ],
);

export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id'),
    stepId: uuid('step_id'),
    projectId: uuid('project_id'),
    agentKey: agentKey('agent_key'),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('llm_usage_run_idx').on(t.runId),
    index('llm_usage_project_idx').on(t.projectId, t.createdAt),
  ],
);

/* -------------------------------------------------------------- knowledge */

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: sourceKind('kind').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    credentialId: uuid('credential_id'),
    status: sourceStatus('status').notNull().default('idle'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastCommit: text('last_commit'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sources_project_idx').on(t.projectId)],
);

export const codeObjects = pgTable(
  'code_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Upper-cased for Oracle objects so lookups are case-insensitive, as in Oracle. */
    name: text('name').notNull(),
    path: text('path'),
    language: text('language'),
    summary: text('summary'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text('content_hash'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(path, '')), 'B')`,
    ),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('code_objects_identity_uq').on(t.sourceId, t.kind, t.name),
    index('code_objects_project_name_idx').on(t.projectId, t.name),
    index('code_objects_search_idx').using('gin', t.searchVector),
    index('code_objects_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

export const codeEdges = pgTable(
  'code_edges',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    fromId: uuid('from_id')
      .notNull()
      .references(() => codeObjects.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => codeObjects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromId, t.toId, t.kind] }),
    index('code_edges_to_idx').on(t.toId),
    index('code_edges_project_idx').on(t.projectId),
  ],
);

export const EMBEDDING_DIMENSIONS = 1024;

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => codeObjects.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    startLine: integer('start_line'),
    endLine: integer('end_line'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(sql`to_tsvector('simple', content)`),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
  },
  (t) => [
    index('chunks_object_idx').on(t.objectId, t.ordinal),
    index('chunks_search_idx').using('gin', t.searchVector),
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

/* ---------------------------------------------------- credentials & misc */

/** Secrets encrypted with AES-256-GCM using MASTER_KEY. Plain text never leaves the server. */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: credentialKind('kind').notNull(),
    ciphertext: text('ciphertext').notNull(),
    createdById: uuid('created_by_id').references(() => users.id),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('credentials_project_name_uq').on(t.projectId, t.name)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);
