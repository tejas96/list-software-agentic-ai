import { and, eq, inArray } from 'drizzle-orm';
import type { ProjectRole } from '@lsa/contracts';
import { notifications, projectMembers, publish, users, type DbOrTx } from '@lsa/db';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string | null;
}

/** Store a notification for each user and push it to their open sessions. */
export async function notifyUsers(tx: DbOrTx, userIds: string[], input: NotificationInput): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const rows = await tx
    .insert(notifications)
    .values(unique.map((userId) => ({ userId, type: input.type, title: input.title, body: input.body ?? '', link: input.link ?? null })))
    .returning({ id: notifications.id, userId: notifications.userId });
  for (const r of rows) await publish(tx, { type: 'notification.added', userId: r.userId, notificationId: r.id });
}

/** Active project members holding one of the given roles. */
export async function projectMembersWithRoles(tx: DbOrTx, projectId: string, roles: ProjectRole[]): Promise<string[]> {
  const rows = await tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.role, roles), eq(users.status, 'active')));
  return rows.map((r) => r.userId);
}

/** People who can decide gates in a project: approvers and admins. */
export async function projectApprovers(tx: DbOrTx, projectId: string): Promise<string[]> {
  return projectMembersWithRoles(tx, projectId, ['approver', 'admin']);
}

/** Users to tell about something that happened on a ticket: reporter, assignee. */
export function ticketWatchers(ticket: { reporterId: string | null; assigneeId: string | null }): string[] {
  return [ticket.reporterId, ticket.assigneeId].filter((x): x is string => !!x);
}

export async function workspaceAdmins(tx: DbOrTx): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isAdmin, true), eq(users.status, 'active')));
  return rows.map((r) => r.id);
}
