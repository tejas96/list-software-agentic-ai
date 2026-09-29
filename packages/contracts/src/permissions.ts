import type { ProjectRole } from './enums.js';

/** Actions checked against a user's role in a project. Workspace admins may do everything. */
export const PERMISSIONS = {
  'project.view': 'viewer',
  'ticket.create': 'requester',
  'ticket.edit': 'requester',
  'ticket.comment': 'viewer',
  'ticket.move': 'requester',
  'run.start': 'requester',
  'run.control': 'requester',
  'gate.decide': 'approver',
  'knowledge.query': 'viewer',
  'knowledge.manage': 'admin',
  'project.manage': 'admin',
  'members.manage': 'admin',
  'credentials.manage': 'admin',
} as const satisfies Record<string, ProjectRole>;

export type Permission = keyof typeof PERMISSIONS;

const RANK: Record<ProjectRole, number> = { viewer: 0, requester: 1, approver: 2, admin: 3 };

export function roleAllows(role: ProjectRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[PERMISSIONS[permission]];
}

export function roleAtLeast(role: ProjectRole | null | undefined, min: ProjectRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

export const ROLE_LABELS: Record<ProjectRole, string> = {
  viewer: 'Viewer',
  requester: 'Requester',
  approver: 'Approver',
  admin: 'Admin',
};

export const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  viewer: 'Can see the project, its board, runs and evidence, and comment.',
  requester: 'Can also create and edit tickets and start or pause runs.',
  approver: 'Can also approve or send back plans and releases at the gates.',
  admin: 'Can also manage members, settings, knowledge sources and credentials.',
};
