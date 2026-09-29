import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { roleAllows, type Permission, type ProjectRole } from '@lsa/contracts';
import { projectMembers, projects } from '@lsa/db';
import { Database } from '../infra/database.js';
import type { SessionUser } from './auth.js';
import { forbidden, notFound } from './errors.js';

/** Resolves a user's role in a project and enforces permissions. */
@Injectable()
export class AccessService {
  constructor(private readonly database: Database) {}

  async roleIn(user: SessionUser, projectId: string): Promise<ProjectRole | null> {
    if (user.isAdmin) return 'admin';
    const [m] = await this.database.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)));
    return m?.role ?? null;
  }

  /**
   * Throws 404 when the user cannot see the project (so ids of other clients'
   * projects are not confirmed), 403 when they can see it but lack the permission.
   */
  async require(user: SessionUser, projectId: string, permission: Permission): Promise<ProjectRole> {
    const role = await this.roleIn(user, projectId);
    if (!role) throw notFound('Project');
    if (!roleAllows(role, permission)) throw forbidden(permissionMessage(permission));
    return role;
  }

  /**
   * Projects whose work the user sees in cross-project views; null means "no restriction".
   * Archived projects are left out of working views; the audit log passes includeArchived
   * so administrators keep the complete history.
   */
  async visibleProjectIds(
    user: SessionUser,
    opts: { includeArchived?: boolean } = {},
  ): Promise<string[] | null> {
    if (user.isAdmin) {
      if (opts.includeArchived) return null;
      const rows = await this.database.db
        .select({ id: projects.id })
        .from(projects)
        .where(isNull(projects.archivedAt));
      return rows.map((r) => r.id);
    }
    const rows = await this.database.db
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, user.id), isNull(projects.archivedAt)));
    return rows.map((r) => r.id);
  }
}

function permissionMessage(p: Permission): string {
  switch (p) {
    case 'gate.decide':
      return 'Only approvers can decide at a gate in this project';
    case 'ticket.create':
    case 'ticket.edit':
    case 'ticket.move':
      return 'Viewers cannot change tickets. Ask a project admin for the Requester role.';
    case 'run.start':
    case 'run.control':
      return 'You need the Requester role to start or control runs in this project';
    default:
      return 'Only project admins can do this';
  }
}
