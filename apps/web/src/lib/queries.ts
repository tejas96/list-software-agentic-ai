'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  ActivityDto,
  ArtifactDto,
  AskAnswerDto,
  CommentDto,
  CredentialDto,
  DashboardDto,
  GateDto,
  MeDto,
  MemberDto,
  NotificationDto,
  ObjectGraphDto,
  ProjectDto,
  RunDetailDto,
  RunSummaryDto,
  SearchHitDto,
  SourceDto,
  TicketDto,
  TicketSummaryDto,
  UserDto,
  WorkspaceStatusDto,
} from '@lsa/contracts';
import { api, del, get, patch, post, qs } from './api';

export const keys = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  project: (k: string) => ['project', k] as const,
  members: (id: string) => ['members', id] as const,
  tickets: (f: Record<string, unknown>) => ['tickets', f] as const,
  ticket: (k: string) => ['ticket', k] as const,
  timeline: (k: string) => ['timeline', k] as const,
  comments: (k: string) => ['comments', k] as const,
  run: (id: string) => ['run', id] as const,
  activeRuns: ['runs', 'active'] as const,
  approvals: ['approvals'] as const,
  dashboard: ['dashboard'] as const,
  notifications: ['notifications'] as const,
  status: ['workspace-status'] as const,
  sources: (id: string) => ['sources', id] as const,
  credentials: (id: string) => ['credentials', id] as const,
  users: ['users'] as const,
  directory: ['directory'] as const,
  evidence: (k: string) => ['evidence', k] as const,
  artifact: (id: string) => ['artifact', id] as const,
  labels: (id: string) => ['labels', id] as const,
  audit: (p: string | undefined) => ['audit', p ?? 'all'] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => get<MeDto>('/auth/me'), retry: false, staleTime: 60_000 });
export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: () => get<ProjectDto[]>('/projects') });
export const useProject = (key: string | null | undefined) =>
  useQuery({
    queryKey: keys.project(key ?? ''),
    queryFn: () => get<ProjectDto>(`/projects/${key}`),
    enabled: !!key,
  });
export const useMembers = (projectId: string | undefined) =>
  useQuery({
    queryKey: keys.members(projectId ?? ''),
    queryFn: () => get<MemberDto[]>(`/projects/${projectId}/members`),
    enabled: !!projectId,
  });

export interface TicketFilters {
  projectId?: string;
  q?: string;
  type?: string[];
  priority?: string[];
  assigneeId?: string;
  label?: string;
  mine?: boolean;
  includeCancelled?: boolean;
}
export const useTickets = (f: TicketFilters, enabled = true) =>
  useQuery({
    queryKey: keys.tickets(f as Record<string, unknown>),
    queryFn: () => get<TicketSummaryDto[]>(`/tickets${qs({ ...f, limit: 500 })}`),
    enabled,
  });
export const useTicket = (key: string) =>
  useQuery({ queryKey: keys.ticket(key), queryFn: () => get<TicketDto>(`/tickets/${key}`) });
export const useTimeline = (key: string) =>
  useQuery({ queryKey: keys.timeline(key), queryFn: () => get<ActivityDto[]>(`/tickets/${key}/timeline`) });
export const useComments = (key: string) =>
  useQuery({ queryKey: keys.comments(key), queryFn: () => get<CommentDto[]>(`/tickets/${key}/comments`) });
export const useLabels = (projectId: string | undefined) =>
  useQuery({
    queryKey: keys.labels(projectId ?? ''),
    queryFn: () => get<string[]>(`/tickets/labels?projectId=${projectId}`),
    enabled: !!projectId,
  });
export const useRun = (id: string | null | undefined) =>
  useQuery({ queryKey: keys.run(id ?? ''), queryFn: () => get<RunDetailDto>(`/runs/${id}`), enabled: !!id });
export const useActiveRuns = () =>
  useQuery({ queryKey: keys.activeRuns, queryFn: () => get<RunSummaryDto[]>('/runs/active') });
export const useApprovals = () =>
  useQuery({ queryKey: keys.approvals, queryFn: () => get<GateDto[]>('/approvals') });
export const useDashboard = () =>
  useQuery({ queryKey: keys.dashboard, queryFn: () => get<DashboardDto>('/dashboard') });
export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => get<{ items: NotificationDto[]; unread: number }>('/notifications'),
  });
export const useWorkspaceStatus = () =>
  useQuery({
    queryKey: keys.status,
    queryFn: () => get<WorkspaceStatusDto>('/workspace/status'),
    staleTime: 30_000,
  });
export const useSources = (projectId: string | undefined) =>
  useQuery({
    queryKey: keys.sources(projectId ?? ''),
    queryFn: () => get<SourceDto[]>(`/projects/${projectId}/sources`),
    enabled: !!projectId,
  });
export const useCredentials = (projectId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.credentials(projectId ?? ''),
    queryFn: () => get<CredentialDto[]>(`/projects/${projectId}/credentials`),
    enabled: !!projectId && enabled,
  });
export const useUsers = (enabled = true) =>
  useQuery({ queryKey: keys.users, queryFn: () => get<UserDto[]>('/users'), enabled });
export const useDirectory = () =>
  useQuery({
    queryKey: keys.directory,
    queryFn: () => get<{ id: string; name: string; email: string }[]>('/users/directory'),
  });
export const useArtifact = (id: string | null) =>
  useQuery({
    queryKey: keys.artifact(id ?? ''),
    queryFn: () => get<ArtifactDto>(`/artifacts/${id}`),
    enabled: !!id,
  });
export const useAudit = (projectId?: string) =>
  useQuery({
    queryKey: keys.audit(projectId),
    queryFn: () => get<ActivityDto[]>(`/audit${qs({ projectId })}`),
  });

export interface EvidenceDto {
  ticket: {
    id: string;
    key: string;
    title: string;
    type: string;
    status: string;
    createdAt: string;
    closedAt: string | null;
  };
  runs: {
    id: string;
    workflowType: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    costUsd: number;
    branch: string | null;
  }[];
  approvals: GateDto[];
  artifacts: (ArtifactDto & { content: unknown })[];
  trail: ActivityDto[];
  generatedAt: string;
}
export const useEvidence = (key: string) =>
  useQuery({ queryKey: keys.evidence(key), queryFn: () => get<EvidenceDto>(`/evidence/${key}`) });

export const searchKnowledge = (projectId: string, q: string, kind?: string) =>
  get<SearchHitDto[]>(`/knowledge/search${qs({ projectId, q, kind })}`);
export const objectGraph = (id: string, depth = 1) =>
  get<ObjectGraphDto>(`/knowledge/objects/${id}/graph?depth=${depth}`);
export const knowledgeObject = (id: string) =>
  get<ObjectGraphDto['root'] & { content: string }>(`/knowledge/objects/${id}`);
export const askKnowledge = (projectId: string, question: string) =>
  post<AskAnswerDto>('/knowledge/ask', { projectId, question });

/** A mutation that invalidates the given keys on success. */
export function useAction<TVars, TRes>(fn: (v: TVars) => Promise<TRes>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
    },
  });
}

export { api, del, get, patch, post };
