import { Controller, Get, HttpCode, Injectable, Module, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ChangePasswordRequest, LoginRequest, type MeDto } from '@lsa/contracts';
import { appendActivity, hashPassword, projectMembers, projects, users, verifyPassword } from '@lsa/db';
import { CurrentUser, Public, SessionTokens, type SessionUser } from '../common/auth.js';
import { AppError, invalid } from '../common/errors.js';
import { ZBody } from '../common/zod.js';
import { Database } from '../infra/database.js';
import { toUserDto } from '../users/users.module.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  /** A real hash to verify against for unknown emails, so timing does not reveal which emails exist. */
  private readonly dummyHash = hashPassword('placeholder-password-for-timing');

  constructor(
    private readonly database: Database,
    private readonly tokens: SessionTokens,
  ) {}

  async login(req: LoginRequest, ip: string | undefined): Promise<{ token: string; user: MeDto }> {
    const db = this.database.db;
    const [u] = await db.select().from(users).where(eq(sql`lower(${users.email})`, req.email.toLowerCase()));
    const generic = new AppError(401, 'invalid_credentials', 'Email or password is not correct');
    if (!u) {
      await verifyPassword(await this.dummyHash, req.password);
      throw generic;
    }
    if (u.status !== 'active') throw new AppError(403, 'account_disabled', 'This account is disabled. Contact an administrator.');
    if (u.lockedUntil && u.lockedUntil > new Date()) {
      throw new AppError(423, 'account_locked', `Too many failed attempts. Try again after ${u.lockedUntil.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`);
    }
    const ok = await verifyPassword(u.passwordHash, req.password);
    if (!ok) {
      const failed = u.failedLogins + 1;
      await db
        .update(users)
        .set({
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : u.lockedUntil,
        })
        .where(eq(users.id, u.id));
      throw generic;
    }
    await db.transaction(async (tx) => {
      await tx.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
      await appendActivity(tx, {
        projectId: null,
        actorType: 'user',
        actorId: u.id,
        type: 'user.login',
        summary: `${u.name} signed in`,
        data: { ip: ip ?? null },
      });
    });
    const token = this.tokens.issue(u.id, u.sessionVersion);
    return { token, user: await this.me({ id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin }) };
  }

  async me(user: SessionUser): Promise<MeDto> {
    const db = this.database.db;
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    if (!u) throw new AppError(401, 'unauthenticated', 'Sign in to continue');
    const memberships = user.isAdmin
      ? (await db.select({ id: projects.id, key: projects.key, name: projects.name }).from(projects).where(isNull(projects.archivedAt))).map(
          (p) => ({ projectId: p.id, projectKey: p.key, projectName: p.name, role: 'admin' as const }),
        )
      : await db
          .select({ projectId: projects.id, projectKey: projects.key, projectName: projects.name, role: projectMembers.role })
          .from(projectMembers)
          .innerJoin(projects, eq(projects.id, projectMembers.projectId))
          .where(and(eq(projectMembers.userId, user.id), isNull(projects.archivedAt)));
    return { ...toUserDto(u), memberships };
  }

  async changePassword(user: SessionUser, req: ChangePasswordRequest): Promise<string> {
    const db = this.database.db;
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    if (!u || !(await verifyPassword(u.passwordHash, req.currentPassword))) {
      throw invalid('Current password is not correct');
    }
    if (req.currentPassword === req.newPassword) throw invalid('Choose a password different from the current one');
    const [updated] = await db
      .update(users)
      .set({ passwordHash: await hashPassword(req.newPassword), sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id))
      .returning({ sv: users.sessionVersion });
    return this.tokens.issue(user.id, updated!.sv);
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: SessionTokens,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@ZBody(LoginRequest) body: LoginRequest, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MeDto> {
    const { token, user } = await this.auth.login(body, req.ip);
    this.tokens.setCookie(res, token);
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    this.tokens.clearCookie(res);
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): Promise<MeDto> {
    return this.auth.me(user);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: SessionUser,
    @ZBody(ChangePasswordRequest) body: ChangePasswordRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Other sessions are signed out; this one gets a fresh token.
    this.tokens.setCookie(res, await this.auth.changePassword(user, body));
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
