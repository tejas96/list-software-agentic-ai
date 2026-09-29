import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { users } from '@lsa/db';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Database } from '../infra/database.js';
import { AppError, forbidden } from './errors.js';

export const SESSION_COOKIE = 'lsa_session';
/** Custom header required on state-changing requests. Cross-site forms cannot set it (CSRF defence). */
export const CSRF_HEADER = 'x-lsa-client';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

interface SessionClaims {
  sub: string;
  sv: number;
}

export type AuthedRequest = Request & { user?: SessionUser; id?: string };

const PUBLIC_KEY = 'lsa:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
const ADMIN_KEY = 'lsa:admin';
/** Only workspace administrators may call this route. */
export const AdminOnly = () => SetMetadata(ADMIN_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new AppError(401, 'unauthenticated', 'Sign in to continue');
  return req.user;
});

@Injectable()
export class SessionTokens {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  issue(userId: string, sessionVersion: number): string {
    return jwt.sign({ sub: userId, sv: sessionVersion } satisfies SessionClaims, this.config.JWT_SECRET, {
      expiresIn: `${this.config.SESSION_HOURS}h`,
      algorithm: 'HS256',
    });
  }

  verify(token: string): SessionClaims | null {
    try {
      const claims = jwt.verify(token, this.config.JWT_SECRET, { algorithms: ['HS256'] }) as SessionClaims;
      return typeof claims.sub === 'string' && typeof claims.sv === 'number' ? claims : null;
    } catch {
      return null;
    }
  }

  setCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.NODE_ENV === 'production',
      maxAge: this.config.SESSION_HOURS * 3600 * 1000,
      path: '/',
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Resolve the user for a raw token (used by HTTP and WebSocket auth). */
  async resolve(database: Database, token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const claims = this.verify(token);
    if (!claims) return null;
    const [u] = await database.db
      .select({ id: users.id, email: users.email, name: users.name, isAdmin: users.isAdmin, status: users.status, sv: users.sessionVersion })
      .from(users)
      .where(eq(users.id, claims.sub));
    if (!u || u.status !== 'active' || u.sv !== claims.sv) return null;
    return { id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: SessionTokens,
    private readonly database: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const hasCookie = Boolean(req.cookies?.[SESSION_COOKIE]);
    if (mutating && hasCookie && !req.headers[CSRF_HEADER]) {
      throw new AppError(403, 'csrf', 'Request blocked: missing client header');
    }

    if (isPublic) return true;
    const user = await this.tokens.resolve(this.database, req.cookies?.[SESSION_COOKIE] as string | undefined);
    if (!user) throw new AppError(401, 'unauthenticated', 'Your session has ended. Sign in again.');
    req.user = user;

    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (adminOnly && !user.isAdmin) throw forbidden('Only workspace administrators can do this');
    return true;
  }
}
