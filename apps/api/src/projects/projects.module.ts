import { Controller, Delete, Get, HttpCode, Injectable, Module, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  AddMemberRequest,
  CreateProjectRequest,
  ProjectSettings,
  resolveProjectSettings,
  UpdateMemberRequest,
  UpdateProjectRequest,
  type MemberDto,
  type ProjectDto,
  type ProjectRole,
} from '@lsa/contracts';
import { appendActivity, projectMembers, projects, users } from '@lsa/db';
import { AccessService } from '../common/access.service.js';
import { AdminOnly, CurrentUser, type SessionUser } from '../common/auth.js';
import { invalid, notFound } from '../common/errors.js';
import { UuidParam, ZBody } from '../common/zod.js';
import { Database } from '../infra/database.js';

type ProjectRow = typeof projects.$inferSelect;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: Database,
    private readonly access: AccessService,
  ) {}

  private async counts(ids: string[]): Promise<Map<string, ProjectDto['counts']>> {
    const map = new Map<string, ProjectDto['counts']>();
    if (ids.length === 0) return map;
    const rows = await this.database.db.execute<{
      project_id: string;
      open: number;
      needs_approval: number;
      blocked: number;
      active_runs: number;
    }>(sql`
      select p.id as project_id,
        (select count(*)::int from tickets t where t.project_id = p.id and t.status not in ('done','cancelled')) as open,
        (select count(*)::int from gates g where g.project_id = p.id and g.status = 'pending') as needs_approval,
        (select count(*)::int from tickets t where t.project_id = p.id and t.status = 'blocked') as blocked,
        (select count(*)::int from runs r where r.project_id = p.id and r.status in ('queued','running','awaiting_approval','paused','blocked')) as active_runs
      from projects p where p.id in ${ids}
    `);
    for (const r of rows.rows) {
      map.set(r.project_id, { open: r.open, needsApproval: r.needs_approval, blocked: r.blocked, activeRuns: r.active_runs });
    }
    return map;
  }

  private toDto(p: ProjectRow, role: ProjectRole | null, counts?: ProjectDto['counts']): ProjectDto {
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      clientName: p.clientName,
      techStack: p.techStack,
      settings: resolveProjectSettings(p.settings),
      archived: p.archivedAt !== null,
      createdAt: p.createdAt.toISOString(),
      myRole: role,
      counts: counts ?? { open: 0, needsApproval: 0, blocked: 0, activeRuns: 0 },
    };
  }

  async list(user: SessionUser, includeArchived = false): Promise<ProjectDto[]> {
    const db = this.database.db;
    let rows: { p: ProjectRow; role: ProjectRole }[];
    if (user.isAdmin) {
      const ps = await db
        .select()
        .from(projects)
        .where(includeArchived ? undefined : isNull(projects.archivedAt))
        .orderBy(asc(projects.name));
      rows = ps.map((p) => ({ p, role: 'admin' as const }));
    } else {
      rows = await db
        .select({ p: projects, role: projectMembers.role })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(and(eq(projectMembers.userId, user.id), includeArchived ? undefined : isNull(projects.archivedAt)))
        .orderBy(asc(projects.name));
    }
    const counts = await this.counts(rows.map((r) => r.p.id));
    return rows.map((r) => this.toDto(r.p, r.role, counts.get(r.p.id)));
  }

  async get(user: SessionUser, idOrKey: string): Promise<ProjectDto> {
    const p = await this.find(idOrKey);
    const role = await this.access.require(user, p.id, 'project.view');
    const counts = await this.counts([p.id]);
    return this.toDto(p, role, counts.get(p.id));
  }

  async find(idOrKey: string): Promise<ProjectRow> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
    const [p] = await this.database.db
      .select()
      .from(projects)
      .where(isUuid ? eq(projects.id, idOrKey) : eq(projects.key, idOrKey.toUpperCase()));
    if (!p) throw notFound('Project');
    return p;
  }

  async create(user: SessionUser, req: CreateProjectRequest): Promise<ProjectDto> {
    return this.database.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({
          key: req.key,
          name: req.name,
          description: req.description,
          clientName: req.clientName,
          techStack: req.techStack,
          settings: ProjectSettings.parse({}),
          createdById: user.id,
        })
        .returning();
      await tx.insert(projectMembers).values({ projectId: p!.id, userId: user.id, role: 'admin' });
      await appendActivity(tx, {
        projectId: p!.id,
        actorType: 'user',
        actorId: user.id,
        type: 'project.created',
        summary: `${user.name} created project ${p!.key} · ${p!.name}`,
        data: { key: p!.key },
      });
      return this.toDto(p!, 'admin');
    });
  }

  async update(user: SessionUser, id: string, req: UpdateProjectRequest): Promise<ProjectDto> {
    await this.access.require(user, id, 'project.manage');
    return this.database.db.transaction(async (tx) => {
      const [current] = await tx.select().from(projects).where(eq(projects.id, id)).for('update');
      if (!current) throw notFound('Project');
      const settings = req.settings
        ? ProjectSettings.parse({ ...resolveProjectSettings(current.settings), ...req.settings })
        : undefined;
      if (settings?.allowedCommands.some((c) => /[;&|`$<>]/.test(c))) {
        throw invalid('Allowed commands must be plain executable names without shell characters');
      }
      const [p] = await tx
        .update(projects)
        .set({
          ...(req.name !== undefined && { name: req.name }),
          ...(req.description !== undefined && { description: req.description }),
          ...(req.clientName !== undefined && { clientName: req.clientName }),
          ...(req.techStack !== undefined && { techStack: req.techStack }),
          ...(settings && { settings }),
          ...(req.archived !== undefined && { archivedAt: req.archived ? new Date() : null }),
        })
        .where(eq(projects.id, id))
        .returning();
      const fields = Object.keys(req);
      await appendActivity(tx, {
        projectId: id,
        actorType: 'user',
        actorId: user.id,
        type: 'project.updated',
        summary: `${user.name} updated project ${p!.key}: ${fields.join(', ')}`,
        data: { fields, settings: req.settings ?? null },
      });
      return this.toDto(p!, await this.access.roleIn(user, id));
    });
  }

  async members(user: SessionUser, projectId: string): Promise<MemberDto[]> {
    await this.access.require(user, projectId, 'project.view');
    const rows = await this.database.db
      .select({ userId: users.id, name: users.name, email: users.email, role: projectMembers.role, addedAt: projectMembers.createdAt })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(users.name));
    return rows.map((r) => ({ ...r, addedAt: r.addedAt.toISOString() }));
  }

  async addMember(user: SessionUser, projectId: string, req: AddMemberRequest): Promise<MemberDto[]> {
    await this.access.require(user, projectId, 'members.manage');
    await this.database.db.transaction(async (tx) => {
      const [target] = await tx.select().from(users).where(eq(users.id, req.userId));
      if (!target) throw notFound('User');
      await tx
        .insert(projectMembers)
        .values({ projectId, userId: req.userId, role: req.role })
        .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: req.role } });
      await appendActivity(tx, {
        projectId,
        actorType: 'user',
        actorId: user.id,
        type: 'member.added',
        summary: `${user.name} gave ${target.name} the ${req.role} role`,
        data: { userId: req.userId, role: req.role },
      });
    });
    return this.members(user, projectId);
  }

  async updateMember(user: SessionUser, projectId: string, userId: string, req: UpdateMemberRequest): Promise<MemberDto[]> {
    await this.access.require(user, projectId, 'members.manage');
    await this.database.db.transaction(async (tx) => {
      await this.guardLastAdmin(tx, projectId, userId, req.role);
      const [m] = await tx
        .update(projectMembers)
        .set({ role: req.role })
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
        .returning();
      if (!m) throw notFound('Member');
      await appendActivity(tx, {
        projectId,
        actorType: 'user',
        actorId: user.id,
        type: 'member.updated',
        summary: `${user.name} changed a member's role to ${req.role}`,
        data: { userId, role: req.role },
      });
    });
    return this.members(user, projectId);
  }

  async removeMember(user: SessionUser, projectId: string, userId: string): Promise<MemberDto[]> {
    await this.access.require(user, projectId, 'members.manage');
    await this.database.db.transaction(async (tx) => {
      await this.guardLastAdmin(tx, projectId, userId, null);
      const [m] = await tx
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
        .returning();
      if (!m) throw notFound('Member');
      await appendActivity(tx, {
        projectId,
        actorType: 'user',
        actorId: user.id,
        type: 'member.removed',
        summary: `${user.name} removed a member from the project`,
        data: { userId },
      });
    });
    return this.members(user, projectId);
  }

  /** A project always keeps at least one admin member. */
  private async guardLastAdmin(tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0], projectId: string, userId: string, newRole: ProjectRole | null) {
    if (newRole === 'admin') return;
    const admins = await tx
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.role, ['admin'])));
    if (admins.length === 1 && admins[0]!.userId === userId) {
      throw invalid('A project needs at least one admin. Make someone else admin first.');
    }
  }

  /** Create or replace the project's intake token. Returned once; only its hash is stored. */
  async rotateIntakeToken(user: SessionUser, projectId: string): Promise<{ token: string; endpoint: string }> {
    await this.access.require(user, projectId, 'project.manage');
    const token = `lsa_it_${randomBytes(24).toString('base64url')}`;
    const [p] = await this.database.db
      .update(projects)
      .set({ intakeTokenHash: createHash('sha256').update(token).digest('hex') })
      .where(eq(projects.id, projectId))
      .returning({ key: projects.key });
    if (!p) throw notFound('Project');
    return { token, endpoint: `/api/v1/intake/${p.key}` };
  }
}

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.svc.list(user);
  }

  @AdminOnly()
  @Get('all')
  listAll(@CurrentUser() user: SessionUser) {
    return this.svc.list(user, true);
  }

  @AdminOnly()
  @Post()
  create(@CurrentUser() user: SessionUser, @ZBody(CreateProjectRequest) body: CreateProjectRequest) {
    return this.svc.create(user, body);
  }

  @Get(':idOrKey')
  get(@CurrentUser() user: SessionUser, @Param('idOrKey') idOrKey: string) {
    return this.svc.get(user, idOrKey);
  }

  @Patch(':id')
  update(@CurrentUser() user: SessionUser, @UuidParam('id') id: string, @ZBody(UpdateProjectRequest) body: UpdateProjectRequest) {
    return this.svc.update(user, id, body);
  }

  @Get(':id/members')
  members(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.members(user, id);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: SessionUser, @UuidParam('id') id: string, @ZBody(AddMemberRequest) body: AddMemberRequest) {
    return this.svc.addMember(user, id, body);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentUser() user: SessionUser,
    @UuidParam('id') id: string,
    @UuidParam('userId') userId: string,
    @ZBody(UpdateMemberRequest) body: UpdateMemberRequest,
  ) {
    return this.svc.updateMember(user, id, userId, body);
  }

  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() user: SessionUser, @UuidParam('id') id: string, @UuidParam('userId') userId: string) {
    return this.svc.removeMember(user, id, userId);
  }

  @Post(':id/intake-token')
  @HttpCode(200)
  rotateIntakeToken(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.rotateIntakeToken(user, id);
  }
}

@Module({ controllers: [ProjectsController], providers: [ProjectsService], exports: [ProjectsService] })
export class ProjectsModule {}
