import { Controller, Get, Injectable, Module, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { asc, eq, sql } from 'drizzle-orm';
import { CreateUserRequest, UpdateUserRequest, type UserDto } from '@lsa/contracts';
import { appendActivity, hashPassword, users } from '@lsa/db';
import { AdminOnly, CurrentUser, type SessionUser } from '../common/auth.js';
import { invalid, notFound } from '../common/errors.js';
import { UuidParam, ZBody } from '../common/zod.js';
import { Database } from '../infra/database.js';

export function toUserDto(u: typeof users.$inferSelect): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly database: Database) {}

  async list(): Promise<UserDto[]> {
    const rows = await this.database.db.select().from(users).orderBy(asc(users.name));
    return rows.map(toUserDto);
  }

  /** Minimal directory for people pickers (name and email only). */
  async directory(): Promise<{ id: string; name: string; email: string }[]> {
    return this.database.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.status, 'active'))
      .orderBy(asc(users.name));
  }

  async create(actor: SessionUser, req: CreateUserRequest): Promise<UserDto> {
    return this.database.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: req.email.toLowerCase(),
          name: req.name,
          passwordHash: await hashPassword(req.password),
          isAdmin: req.isAdmin,
        })
        .returning();
      await appendActivity(tx, {
        projectId: null,
        actorType: 'user',
        actorId: actor.id,
        type: 'user.created',
        summary: `${actor.name} added ${u!.name} (${u!.email})${u!.isAdmin ? ' as administrator' : ''}`,
        data: { userId: u!.id, isAdmin: u!.isAdmin },
      });
      return toUserDto(u!);
    });
  }

  async update(actor: SessionUser, id: string, req: UpdateUserRequest): Promise<UserDto> {
    if (id === actor.id && (req.isAdmin === false || req.status === 'disabled')) {
      throw invalid('You cannot remove your own administrator role or disable your own account');
    }
    return this.database.db.transaction(async (tx) => {
      const [current] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!current) throw notFound('User');
      const endSessions = req.password !== undefined || req.status === 'disabled';
      const [u] = await tx
        .update(users)
        .set({
          ...(req.name !== undefined && { name: req.name }),
          ...(req.isAdmin !== undefined && { isAdmin: req.isAdmin }),
          ...(req.status !== undefined && { status: req.status }),
          ...(req.password !== undefined && {
            passwordHash: await hashPassword(req.password),
            failedLogins: 0,
            lockedUntil: null,
          }),
          ...(endSessions && { sessionVersion: sql`${users.sessionVersion} + 1` }),
        })
        .where(eq(users.id, id))
        .returning();
      const changes = Object.keys(req).filter((k) => k !== 'password');
      if (req.password) changes.push('password reset');
      await appendActivity(tx, {
        projectId: null,
        actorType: 'user',
        actorId: actor.id,
        type: 'user.updated',
        summary: `${actor.name} updated ${u!.name}: ${changes.join(', ')}`,
        data: { userId: id, fields: changes },
      });
      return toUserDto(u!);
    });
  }
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get('directory')
  directory() {
    return this.svc.directory();
  }

  @AdminOnly()
  @Get()
  list() {
    return this.svc.list();
  }

  @AdminOnly()
  @Post()
  create(@CurrentUser() actor: SessionUser, @ZBody(CreateUserRequest) body: CreateUserRequest) {
    return this.svc.create(actor, body);
  }

  @AdminOnly()
  @Patch(':id')
  update(
    @CurrentUser() actor: SessionUser,
    @UuidParam('id') id: string,
    @ZBody(UpdateUserRequest) body: UpdateUserRequest,
  ) {
    return this.svc.update(actor, id, body);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
