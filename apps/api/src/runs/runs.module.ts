import { Controller, Get, HttpCode, Injectable, Logger, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, eq, inArray } from 'drizzle-orm';
import {
  DecideGateRequest,
  RunControlRequest,
  StartRunRequest,
  type GateDto,
} from '@lsa/contracts';
import { appendActivity, gates, publish } from '@lsa/db';
import { AccessService } from '../common/access.service.js';
import { CurrentUser, type SessionUser } from '../common/auth.js';
import { forbidden, invalid, notFound } from '../common/errors.js';
import { UuidParam, ZBody } from '../common/zod.js';
import { Database } from '../infra/database.js';
import { TemporalService } from '../infra/temporal.service.js';
import { RunsService } from './runs.service.js';

const DECISION_LABEL = { approved: 'approved', changes_requested: 'sent back for changes', rejected: 'rejected' } as const;
const GATE_LABEL = { plan: 'the change plan', release: 'the release', escalation: 'the escalation' } as const;

@Injectable()
export class GatesService {
  private readonly logger = new Logger('Gates');

  constructor(
    private readonly database: Database,
    private readonly access: AccessService,
    private readonly runsSvc: RunsService,
    private readonly temporal: TemporalService,
  ) {}

  /** Pending gates the user can see, newest first. The approvals inbox. */
  async pending(user: SessionUser): Promise<GateDto[]> {
    const visible = await this.access.visibleProjectIds(user);
    if (visible !== null && visible.length === 0) return [];
    const where = visible === null ? eq(gates.status, 'pending') : and(eq(gates.status, 'pending'), inArray(gates.projectId, visible));
    return this.runsSvc.gatesFor(user, where!);
  }

  async get(user: SessionUser, gateId: string): Promise<GateDto> {
    const [g] = await this.database.db.select({ projectId: gates.projectId }).from(gates).where(eq(gates.id, gateId));
    if (!g) throw notFound('Approval');
    await this.access.require(user, g.projectId, 'project.view');
    const [dto] = await this.runsSvc.gatesFor(user, eq(gates.id, gateId));
    return dto!;
  }

  /**
   * Record the decision, then signal the workflow. If the signal cannot be
   * delivered, the workflow still picks the decision up: while it waits at a
   * gate it re-reads the gate row every few minutes.
   */
  async decide(user: SessionUser, gateId: string, req: DecideGateRequest): Promise<GateDto> {
    const current = await this.get(user, gateId);
    if (!current.canDecide) {
      if (current.status !== 'pending') throw invalid('This approval has already been decided');
      throw forbidden(current.cannotDecideReason ?? 'You cannot decide this approval');
    }
    if (req.decision !== 'approved' && !req.note) {
      throw invalid('Add a note so the agents know what to change');
    }
    await this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(gates)
        .set({ status: req.decision, decidedById: user.id, decidedAt: new Date(), note: req.note ?? null })
        .where(and(eq(gates.id, gateId), eq(gates.status, 'pending')))
        .returning();
      if (!updated) throw invalid('This approval has already been decided');
      await appendActivity(tx, {
        projectId: updated.projectId,
        ticketId: updated.ticketId,
        runId: updated.runId,
        actorType: 'user',
        actorId: user.id,
        type: 'gate.decided',
        summary: `${user.name} ${DECISION_LABEL[req.decision]} ${GATE_LABEL[updated.kind]}${req.note ? `: ${req.note}` : ''}`,
        data: { gateId, kind: updated.kind, decision: req.decision, note: req.note ?? null },
      });
      await publish(tx, { type: 'gate.changed', projectId: updated.projectId, ticketId: updated.ticketId, runId: updated.runId, gateId });
    });
    try {
      await this.temporal.signalGate(current.runId, { gateId, decision: req.decision, note: req.note ?? null, userId: user.id });
    } catch (err) {
      this.logger.warn(`Gate ${gateId} decided but signal failed; workflow will reconcile: ${(err as Error).message}`);
    }
    return this.get(user, gateId);
  }
}

@ApiTags('runs')
@Controller('runs')
export class RunsController {
  constructor(private readonly svc: RunsService) {}

  @Post()
  start(@CurrentUser() user: SessionUser, @ZBody(StartRunRequest) body: StartRunRequest) {
    return this.svc.start(user, body);
  }

  @Get('active')
  active(@CurrentUser() user: SessionUser) {
    return this.svc.listActive(user);
  }

  @Get(':id')
  detail(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.detail(user, id);
  }

  @Post(':id/control')
  @HttpCode(200)
  control(@CurrentUser() user: SessionUser, @UuidParam('id') id: string, @ZBody(RunControlRequest) body: RunControlRequest) {
    return this.svc.control(user, id, body.action, body.note ?? null);
  }
}

@ApiTags('artifacts')
@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly svc: RunsService) {}

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.artifact(user, id);
  }
}

@ApiTags('approvals')
@Controller('approvals')
export class GatesController {
  constructor(private readonly svc: GatesService) {}

  @Get()
  pending(@CurrentUser() user: SessionUser) {
    return this.svc.pending(user);
  }

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(@CurrentUser() user: SessionUser, @UuidParam('id') id: string, @ZBody(DecideGateRequest) body: DecideGateRequest) {
    return this.svc.decide(user, id, body);
  }
}

@Module({
  controllers: [RunsController, ArtifactsController, GatesController],
  providers: [RunsService, GatesService],
  exports: [RunsService, GatesService],
})
export class RunsModule {}

