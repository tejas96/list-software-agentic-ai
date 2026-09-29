import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  CreateCommentRequest,
  CreateTicketRequest,
  ExternalIntakeRequest,
  IntakeRequest,
  MoveTicketRequest,
  TicketListQuery,
  UpdateTicketRequest,
} from '@lsa/contracts';
import { projects } from '@lsa/db';
import { CurrentUser, Public, type SessionUser } from '../common/auth.js';
import { AppError } from '../common/errors.js';
import { ZBody, ZQuery } from '../common/zod.js';
import { Database } from '../infra/database.js';
import { RunsModule } from '../runs/runs.module.js';
import { TicketsService } from './tickets.service.js';

@ApiTags('tickets')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly svc: TicketsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser, @ZQuery(TicketListQuery) q: TicketListQuery) {
    return this.svc.list(user, q);
  }

  @Get('labels')
  labels(@CurrentUser() user: SessionUser, @Query('projectId') projectId: string) {
    return this.svc.labels(user, projectId);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @ZBody(CreateTicketRequest) body: CreateTicketRequest) {
    return this.svc.create(user, body, 'board');
  }

  /** Free-text requirement (Home). Logged on the board first, then triaged by the agents. */
  @Post('intake')
  intake(@CurrentUser() user: SessionUser, @ZBody(IntakeRequest) body: IntakeRequest) {
    return this.svc.intake(user, body);
  }

  @Get(':idOrKey')
  get(@CurrentUser() user: SessionUser, @Param('idOrKey') idOrKey: string) {
    return this.svc.get(user, idOrKey);
  }

  @Patch(':idOrKey')
  update(
    @CurrentUser() user: SessionUser,
    @Param('idOrKey') idOrKey: string,
    @ZBody(UpdateTicketRequest) body: UpdateTicketRequest,
  ) {
    return this.svc.update(user, idOrKey, body);
  }

  @Post(':idOrKey/move')
  @HttpCode(200)
  move(
    @CurrentUser() user: SessionUser,
    @Param('idOrKey') idOrKey: string,
    @ZBody(MoveTicketRequest) body: MoveTicketRequest,
  ) {
    return this.svc.move(user, idOrKey, body);
  }

  @Post(':idOrKey/not-duplicate')
  @HttpCode(200)
  notDuplicate(@CurrentUser() user: SessionUser, @Param('idOrKey') idOrKey: string) {
    return this.svc.clearDuplicate(user, idOrKey);
  }

  @Get(':idOrKey/timeline')
  timeline(@CurrentUser() user: SessionUser, @Param('idOrKey') idOrKey: string) {
    return this.svc.timeline(user, idOrKey);
  }

  @Get(':idOrKey/comments')
  comments(@CurrentUser() user: SessionUser, @Param('idOrKey') idOrKey: string) {
    return this.svc.comments(user, idOrKey);
  }

  @Post(':idOrKey/comments')
  addComment(
    @CurrentUser() user: SessionUser,
    @Param('idOrKey') idOrKey: string,
    @ZBody(CreateCommentRequest) body: CreateCommentRequest,
  ) {
    return this.svc.addComment(user, idOrKey, body);
  }
}

@Injectable()
export class IntakeTokens {
  constructor(private readonly database: Database) {}

  /** Resolve a project from its key and intake token. Constant-time comparison. */
  async projectFor(projectKey: string, authorization: string | undefined): Promise<string> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const [p] = await this.database.db
      .select({ id: projects.id, hash: projects.intakeTokenHash, archivedAt: projects.archivedAt })
      .from(projects)
      .where(eq(projects.key, projectKey.toUpperCase()));
    const denied = new AppError(
      401,
      'invalid_intake_token',
      'The intake token is missing or not valid for this project',
    );
    if (!p?.hash || !token || p.archivedAt) throw denied;
    const given = Buffer.from(createHash('sha256').update(token).digest('hex'));
    const stored = Buffer.from(p.hash);
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) throw denied;
    return p.id;
  }
}

/** External systems (ticket tools, email bridges) log requirements here with a project intake token. */
@ApiTags('intake')
@Controller('intake')
export class IntakeController {
  constructor(
    private readonly svc: TicketsService,
    private readonly tokens: IntakeTokens,
  ) {}

  @Public()
  @Post(':projectKey')
  async intake(
    @Param('projectKey') projectKey: string,
    @Headers('authorization') authorization: string | undefined,
    @ZBody(ExternalIntakeRequest) body: ExternalIntakeRequest,
  ) {
    const projectId = await this.tokens.projectFor(projectKey, authorization);
    return this.svc.externalIntake(projectId, body);
  }
}

@Module({
  imports: [RunsModule],
  controllers: [TicketsController, IntakeController],
  providers: [TicketsService, IntakeTokens],
  exports: [TicketsService],
})
export class TicketsModule {}
