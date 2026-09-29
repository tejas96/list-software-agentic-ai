import { Controller, Delete, Get, HttpCode, Injectable, Logger, Module, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  AskRequest,
  CreateCredentialRequest,
  CreateSourceRequest,
  KnowledgeSearchQuery,
  type AskAnswerDto,
  type CodeObjectDto,
  type CredentialDto,
  type ObjectGraphDto,
  type SearchHitDto,
  type SourceDto,
} from '@lsa/contracts';
import { appendActivity, codeObjects, credentials, llmUsage, publish, SecretBox, sources } from '@lsa/db';
import { answerQuestion, LlmError, LlmGateway } from '@lsa/agents';
import { knowledgeObjectByName, searchKnowledge } from '@lsa/domain';
import { AccessService } from '../common/access.service.js';
import { CurrentUser, type SessionUser } from '../common/auth.js';
import { AppError, invalid, notFound, unavailable } from '../common/errors.js';
import { UuidParam, ZBody, ZQuery } from '../common/zod.js';
import { Database } from '../infra/database.js';
import { TemporalService } from '../infra/temporal.service.js';

function toObjectDto(o: typeof codeObjects.$inferSelect): CodeObjectDto {
  return {
    id: o.id,
    kind: o.kind,
    name: o.name,
    path: o.path,
    language: o.language,
    summary: o.summary,
    metadata: o.metadata,
  };
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger('Knowledge');

  constructor(
    private readonly database: Database,
    private readonly access: AccessService,
    private readonly temporal: TemporalService,
    private readonly box: SecretBox,
    private readonly llm: LlmGateway,
  ) {}

  /* ------------------------------------------------------------- sources */

  async listSources(user: SessionUser, projectId: string): Promise<SourceDto[]> {
    await this.access.require(user, projectId, 'project.view');
    const res = await this.database.db.execute<{
      id: string;
      project_id: string;
      kind: SourceDto['kind'];
      name: string;
      config: Record<string, unknown>;
      status: SourceDto['status'];
      last_synced_at: Date | null;
      last_error: string | null;
      objects: number;
      edges: number;
      chunks: number;
    }>(sql`
      select s.*,
        (select count(*)::int from code_objects o where o.source_id = s.id) as objects,
        (select count(*)::int from code_edges e where e.source_id = s.id) as edges,
        (select count(*)::int from chunks c join code_objects o on o.id = c.object_id where o.source_id = s.id) as chunks
      from sources s where s.project_id = ${projectId} order by s.created_at`);
    return res.rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      kind: r.kind,
      name: r.name,
      config: r.config,
      status: r.status,
      lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null,
      lastError: r.last_error,
      stats: { objects: r.objects, edges: r.edges, chunks: r.chunks },
    }));
  }

  async createSource(user: SessionUser, projectId: string, req: CreateSourceRequest): Promise<SourceDto[]> {
    await this.access.require(user, projectId, 'knowledge.manage');
    if (req.credentialId) await this.assertCredential(projectId, req.credentialId);
    const { kind, name, credentialId, ...config } = req as CreateSourceRequest & {
      credentialId?: string | null;
    };
    if (kind === 'git' && !/^(https?:\/\/|git@|file:\/\/|\/)/.test(String((config as { url: string }).url))) {
      throw invalid('Use an https://, git@ or file:// repository URL');
    }
    const id = await this.database.db.transaction(async (tx) => {
      const [s] = await tx
        .insert(sources)
        .values({ projectId, kind, name, config, credentialId: credentialId ?? null })
        .returning({ id: sources.id });
      await appendActivity(tx, {
        projectId,
        actorType: 'user',
        actorId: user.id,
        type: 'source.created',
        summary: `${user.name} connected ${kind === 'git' ? 'repository' : 'Oracle schema'} source “${name}”`,
        data: { sourceId: s!.id, kind },
      });
      return s!.id;
    });
    await this.sync(user, id).catch((err: Error) =>
      this.logger.warn(`Initial sync not started: ${err.message}`),
    );
    return this.listSources(user, projectId);
  }

  async deleteSource(user: SessionUser, sourceId: string): Promise<void> {
    const [s] = await this.database.db.select().from(sources).where(eq(sources.id, sourceId));
    if (!s) throw notFound('Source');
    await this.access.require(user, s.projectId, 'knowledge.manage');
    await this.database.db.delete(sources).where(eq(sources.id, sourceId));
  }

  async sync(user: SessionUser, sourceId: string): Promise<{ status: 'started' | 'already_running' }> {
    const [s] = await this.database.db.select().from(sources).where(eq(sources.id, sourceId));
    if (!s) throw notFound('Source');
    await this.access.require(user, s.projectId, 'knowledge.manage');
    const status = await this.temporal.startSourceSync(sourceId);
    if (status === 'started') {
      await this.database.db.transaction(async (tx) => {
        await tx.update(sources).set({ status: 'syncing', lastError: null }).where(eq(sources.id, sourceId));
        await publish(tx, { type: 'source.changed', projectId: s.projectId, sourceId });
      });
    }
    return { status };
  }

  /* -------------------------------------------------------------- search */

  /** Hybrid ranking shared with the agents: full-text, fuzzy names and (when configured) vectors. */
  async search(user: SessionUser, q: KnowledgeSearchQuery): Promise<SearchHitDto[]> {
    await this.access.require(user, q.projectId, 'knowledge.query');
    const hits = await searchKnowledge(this.database.db, q.projectId, q.q, { kind: q.kind, limit: q.limit });
    return hits.map((h) => ({
      object: {
        id: h.id,
        kind: h.kind,
        name: h.name,
        path: h.path,
        language: null,
        summary: h.summary,
        metadata: h.metadata,
      },
      snippet: h.snippet,
      score: h.score,
    }));
  }

  /** Answer a question about the codebase from the knowledge graph, citing objects. */
  async ask(user: SessionUser, req: AskRequest): Promise<AskAnswerDto> {
    await this.access.require(user, req.projectId, 'knowledge.query');
    if (!this.llm.available)
      throw unavailable('No LLM provider is configured. An administrator needs to set ANTHROPIC_API_KEY.');
    const hits = await searchKnowledge(this.database.db, req.projectId, req.question.slice(0, 300), {
      limit: 8,
    });
    const sources: { id: string; name: string; kind: string; path: string | null; text: string }[] = [];
    for (const h of hits.slice(0, 6)) {
      const o = await knowledgeObjectByName(this.database.db, req.projectId, h.name);
      if (o)
        sources.push({
          id: o.id,
          name: o.name,
          kind: o.kind,
          path: o.path,
          text: `${o.summary ?? ''}\n${o.content}`,
        });
    }
    try {
      const res = await answerQuestion(this.llm, {
        agent: 'legacy_intelligence',
        question: req.question,
        sources,
      });
      await this.database.db.insert(llmUsage).values({
        projectId: req.projectId,
        agentKey: 'legacy_intelligence',
        purpose: 'knowledge_ask',
        model: res.usage.model,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        cacheReadTokens: res.usage.cacheReadTokens,
        cacheWriteTokens: res.usage.cacheWriteTokens,
        costUsd: res.usage.costUsd,
      });
      return {
        answer: res.answer,
        citations: sources
          .filter((s) => res.cited.includes(s.name))
          .map((s) => ({ objectId: s.id, name: s.name, path: s.path })),
      };
    } catch (err) {
      if (err instanceof LlmError) throw new AppError(err.retryable ? 503 : 422, 'llm_error', err.message);
      throw err;
    }
  }

  /** An object with its neighbours up to `depth` hops, both directions. */
  async graph(user: SessionUser, objectId: string, depth: number): Promise<ObjectGraphDto> {
    const [root] = await this.database.db.select().from(codeObjects).where(eq(codeObjects.id, objectId));
    if (!root) throw notFound('Object');
    await this.access.require(user, root.projectId, 'knowledge.query');
    const d = Math.max(1, Math.min(3, depth));
    const edges = await this.database.db.execute<{ from_id: string; to_id: string; kind: string }>(sql`
      with recursive walk(id, lvl) as (
        select ${objectId}::uuid, 0
        union
        select case when e.from_id = w.id then e.to_id else e.from_id end, w.lvl + 1
        from walk w join code_edges e on e.from_id = w.id or e.to_id = w.id
        where w.lvl < ${d}
      )
      select distinct e.from_id, e.to_id, e.kind from code_edges e
      where e.from_id in (select id from walk) and e.to_id in (select id from walk)
      limit 500`);
    const ids = new Set<string>([objectId]);
    for (const e of edges.rows) {
      ids.add(e.from_id);
      ids.add(e.to_id);
    }
    const nodes = await this.database.db
      .select()
      .from(codeObjects)
      .where(sql`${codeObjects.id} in ${[...ids]}`);
    return {
      root: toObjectDto(root),
      nodes: nodes.map(toObjectDto),
      edges: edges.rows.map((e) => ({ from: e.from_id, to: e.to_id, kind: e.kind })),
    };
  }

  async object(user: SessionUser, objectId: string): Promise<CodeObjectDto & { content: string }> {
    const [o] = await this.database.db.select().from(codeObjects).where(eq(codeObjects.id, objectId));
    if (!o) throw notFound('Object');
    await this.access.require(user, o.projectId, 'knowledge.query');
    const res = await this.database.db.execute<{ content: string }>(
      sql`select content from chunks where object_id = ${objectId} order by ordinal`,
    );
    return { ...toObjectDto(o), content: res.rows.map((r) => r.content).join('\n') };
  }

  /* --------------------------------------------------------- credentials */

  async listCredentials(user: SessionUser, projectId: string): Promise<CredentialDto[]> {
    await this.access.require(user, projectId, 'credentials.manage');
    const rows = await this.database.db
      .select({
        id: credentials.id,
        projectId: credentials.projectId,
        name: credentials.name,
        kind: credentials.kind,
        createdAt: credentials.createdAt,
        lastUsedAt: credentials.lastUsedAt,
      })
      .from(credentials)
      .where(eq(credentials.projectId, projectId))
      .orderBy(asc(credentials.name));
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async createCredential(
    user: SessionUser,
    projectId: string,
    req: CreateCredentialRequest,
  ): Promise<CredentialDto[]> {
    await this.access.require(user, projectId, 'credentials.manage');
    if (req.kind === 'oracle_db') {
      try {
        const v = JSON.parse(req.secret) as { user?: unknown; password?: unknown };
        if (typeof v.user !== 'string' || typeof v.password !== 'string') throw new Error();
      } catch {
        throw invalid('For an Oracle credential, enter JSON like {"user": "APP_READ", "password": "…"}');
      }
    }
    await this.database.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(credentials)
        .values({
          projectId,
          name: req.name,
          kind: req.kind,
          ciphertext: this.box.encrypt(req.secret),
          createdById: user.id,
        })
        .returning({ id: credentials.id });
      await appendActivity(tx, {
        projectId,
        actorType: 'user',
        actorId: user.id,
        type: 'credential.created',
        summary: `${user.name} stored credential “${req.name}” (${req.kind})`,
        data: { credentialId: c!.id, kind: req.kind },
      });
    });
    return this.listCredentials(user, projectId);
  }

  async deleteCredential(user: SessionUser, credentialId: string): Promise<void> {
    const [c] = await this.database.db.select().from(credentials).where(eq(credentials.id, credentialId));
    if (!c) throw notFound('Credential');
    await this.access.require(user, c.projectId, 'credentials.manage');
    const [inUse] = await this.database.db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.credentialId, credentialId))
      .limit(1);
    if (inUse) throw invalid('A knowledge source uses this credential. Remove or change the source first.');
    await this.database.db.transaction(async (tx) => {
      await tx.delete(credentials).where(eq(credentials.id, credentialId));
      await appendActivity(tx, {
        projectId: c.projectId,
        actorType: 'user',
        actorId: user.id,
        type: 'credential.deleted',
        summary: `${user.name} deleted credential “${c.name}”`,
        data: { credentialId },
      });
    });
  }

  private async assertCredential(projectId: string, credentialId: string): Promise<void> {
    const [c] = await this.database.db
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.id, credentialId), eq(credentials.projectId, projectId)));
    if (!c) throw invalid('Choose a credential stored in this project');
  }
}

@ApiTags('knowledge')
@Controller()
export class KnowledgeController {
  constructor(private readonly svc: KnowledgeService) {}

  @Get('projects/:id/sources')
  sources(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.listSources(user, id);
  }

  @Post('projects/:id/sources')
  createSource(
    @CurrentUser() user: SessionUser,
    @UuidParam('id') id: string,
    @ZBody(CreateSourceRequest) body: CreateSourceRequest,
  ) {
    return this.svc.createSource(user, id, body);
  }

  @Delete('sources/:id')
  @HttpCode(204)
  deleteSource(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.deleteSource(user, id);
  }

  @Post('sources/:id/sync')
  @HttpCode(202)
  sync(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.sync(user, id);
  }

  @Get('knowledge/search')
  search(@CurrentUser() user: SessionUser, @ZQuery(KnowledgeSearchQuery) q: KnowledgeSearchQuery) {
    return this.svc.search(user, q);
  }

  @Post('knowledge/ask')
  @HttpCode(200)
  ask(@CurrentUser() user: SessionUser, @ZBody(AskRequest) body: AskRequest) {
    return this.svc.ask(user, body);
  }

  @Get('knowledge/objects/:id')
  object(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.object(user, id);
  }

  @Get('knowledge/objects/:id/graph')
  graph(@CurrentUser() user: SessionUser, @UuidParam('id') id: string, @Query('depth') depth?: string) {
    return this.svc.graph(user, id, Number(depth ?? 1) || 1);
  }

  @Get('projects/:id/credentials')
  credentials(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.listCredentials(user, id);
  }

  @Post('projects/:id/credentials')
  createCredential(
    @CurrentUser() user: SessionUser,
    @UuidParam('id') id: string,
    @ZBody(CreateCredentialRequest) body: CreateCredentialRequest,
  ) {
    return this.svc.createCredential(user, id, body);
  }

  @Delete('credentials/:id')
  @HttpCode(204)
  deleteCredential(@CurrentUser() user: SessionUser, @UuidParam('id') id: string) {
    return this.svc.deleteCredential(user, id);
  }
}

@Module({ controllers: [KnowledgeController], providers: [KnowledgeService], exports: [KnowledgeService] })
export class KnowledgeModule {}
