/**
 * Names shared by the API (client) and the worker (workflows and activities).
 * This file must stay free of Node-only imports: workflow code is bundled for
 * Temporal's deterministic sandbox.
 */
import type { GateStatus } from './enums.js';

export const WORKFLOW_NAMES = {
  run: 'sdlcRunWorkflow',
  triage: 'triageTicketWorkflow',
  syncSource: 'syncSourceWorkflow',
  agentReply: 'agentReplyWorkflow',
} as const;

export const SIGNALS = {
  gateDecision: 'gateDecision',
  control: 'runControl',
} as const;

export const QUERIES = {
  state: 'runState',
} as const;

export interface RunWorkflowInput {
  runId: string;
}

export interface TriageWorkflowInput {
  ticketId: string;
}

export interface SyncSourceWorkflowInput {
  sourceId: string;
}

export interface AgentReplyWorkflowInput {
  commentId: string;
  agentKey: import('./enums.js').AgentKey;
}

export interface GateDecisionSignal {
  gateId: string;
  decision: Extract<GateStatus, 'approved' | 'changes_requested' | 'rejected'>;
  note: string | null;
  userId: string;
}

export type ControlAction = 'pause' | 'resume' | 'cancel' | 'retry';

export interface RunControlSignal {
  action: ControlAction;
  userId: string;
  note: string | null;
}

export interface RunWorkflowState {
  phase: 'running' | 'awaiting_gate' | 'paused' | 'blocked' | 'finished';
  stage: string | null;
  pendingGateId: string | null;
  qaAttempts: number;
  planRevisions: number;
}

export const workflowIds = {
  run: (runId: string) => `run-${runId}`,
  triage: (ticketId: string) => `triage-${ticketId}`,
  syncSource: (sourceId: string) => `sync-${sourceId}`,
  agentReply: (commentId: string) => `reply-${commentId}`,
};
