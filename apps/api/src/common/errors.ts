import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@lsa/contracts';
import { DomainError } from '@lsa/domain';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, 'forbidden', message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, details);
export const invalid = (message: string, details?: unknown) => new AppError(422, 'invalid', message, details);
export const unavailable = (message: string) => new AppError(503, 'unavailable', message);

const DOMAIN_STATUS: Record<DomainError['code'], number> = {
  not_found: 404,
  conflict: 409,
  invalid: 422,
  forbidden: 403,
  unavailable: 503,
};

/** Postgres unique violation → 409 with a readable message. */
function fromPg(err: unknown): AppError | null {
  const e =
    (err as { cause?: { code?: string; constraint?: string } })?.cause ??
    (err as { code?: string; constraint?: string });
  if (!e || typeof e !== 'object') return null;
  if (e.code === '23505') {
    const c = e.constraint ?? '';
    if (c.includes('projects_key')) return conflict('A project with this key already exists');
    if (c.includes('users_email')) return conflict('A user with this email already exists');
    if (c.includes('runs_one_active')) return conflict('This ticket already has a run in progress');
    if (c.includes('gates_one_pending')) return conflict('This run already has a pending approval');
    if (c.includes('credentials_project_name'))
      return conflict('A credential with this name already exists in the project');
    return conflict('This item already exists');
  }
  if (e.code === '23503') return new AppError(422, 'invalid', 'A referenced item does not exist');
  return null;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req?.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody = {
      error: {
        code: 'internal',
        message:
          'Something went wrong on our side. Try again, and contact an administrator if it keeps happening.',
        requestId,
      },
    };

    const pg = fromPg(exception);
    if (exception instanceof AppError || pg) {
      const e = (pg ?? exception) as AppError;
      status = e.status;
      body = { error: { code: e.code, message: e.message, details: e.details, requestId } };
    } else if (exception instanceof DomainError) {
      status = DOMAIN_STATUS[exception.code];
      body = {
        error: { code: exception.code, message: exception.message, details: exception.details, requestId },
      };
    } else if (exception instanceof ZodError) {
      status = 422;
      body = {
        error: {
          code: 'validation',
          message: 'Some fields are not valid',
          details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          requestId,
        },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const message =
        typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? exception.message);
      body = {
        error: {
          code: status === 429 ? 'rate_limited' : status === 404 ? 'not_found' : 'http_error',
          message:
            status === 429
              ? 'Too many attempts. Wait a minute and try again.'
              : Array.isArray(message)
                ? message.join('; ')
                : message,
          requestId,
        },
      };
    }

    if (status >= 500) {
      this.logger.error(
        `${req?.method} ${req?.url} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (!res.headersSent) res.status(status).json(body);
  }
}
