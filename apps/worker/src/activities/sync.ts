import { heartbeat } from '@temporalio/activity';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { exec, isBinary, readOracleMetadata, Workspace } from '@lsa/adapters';
import { appendActivity, chunks, codeEdges, codeObjects, publish, sources, EMBEDDING_DIMENSIONS, type DbOrTx } from '@lsa/db';
import { buildGraph, graphFromGraphify, graphFromOracleMetadata, type GraphResult, type SourceFile } from '@lsa/knowledge';
import type { Deps } from '../deps.js';
import { decryptCredential } from './workspace.js';

const MAX_FILE_BYTES = 3_000_000;
const MAX_FILES = 50_000;
const SKIP = ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/.next/**', '**/target/**', '**/bin/**', '**/obj/**'];

export function syncActivities(deps: Deps) {
  const { db, config } = deps;

  return {
    /** Pull the source, rebuild its part of the knowledge graph, and record the result. */
    async syncSource(sourceId: string): Promise<{ objects: number; edges: number; chunks: number; warnings: string[] }> {
      const [src] = await db.select().from(sources).where(eq(sources.id, sourceId));
      if (!src) return { objects: 0, edges: 0, chunks: 0, warnings: ['Source was deleted'] };
      await db.transaction(async (tx) => {
        await tx.update(sources).set({ status: 'syncing', lastError: null }).where(eq(sources.id, sourceId));
        await publish(tx, { type: 'source.changed', projectId: src.projectId, sourceId });
      });
      try {
        let graph: GraphResult;
        let commit: string | null = null;
        if (src.kind === 'git') {
          const cfg = src.config as { url: string; branch?: string; includeGlobs?: string[]; excludeGlobs?: string[] };
          const token = await decryptCredential(db, deps.box, src.credentialId);
          const dir = path.join(config.workspacesRoot, 'sources', sourceId);
          const ws = await Workspace.checkout({
            dir,
            url: cfg.url,
            baseBranch: cfg.branch ?? 'main',
            token,
            policy: { allowedCommands: [], sandboxMode: 'local', sandboxImage: config.SANDBOX_IMAGE },
          });
          commit = await ws.headSha();
          heartbeat('checked out');
          const files = await collectFiles(dir, cfg.includeGlobs ?? [], [...SKIP, ...(cfg.excludeGlobs ?? [])]);
          heartbeat(`read ${files.length} files`);
          graph = buildGraph(files);
          const extra = await graphifyGraph(dir, config.GRAPHIFY_CMD);
          if (extra) {
            graph.objects.push(...extra.objects);
            graph.refs.push(...extra.refs);
            graph.warnings.push(...extra.warnings);
          }
        } else {
          const cfg = src.config as { connectString: string; schemas: string[] };
          const secret = await decryptCredential(db, deps.box, src.credentialId);
          if (!secret) throw new Error('The credential for this Oracle source is missing');
          const { user, password } = JSON.parse(secret) as { user: string; password: string };
          graph = graphFromOracleMetadata(await readOracleMetadata({ connectString: cfg.connectString, user, password }, cfg.schemas));
        }
        heartbeat(`parsed ${graph.objects.length} objects`);
        const stats = await persistGraph(db, src.projectId, sourceId, graph);
        if (config.EMBEDDINGS_PROVIDER === 'voyage' && config.VOYAGE_API_KEY) {
          await embedMissing(db, src.projectId, config.VOYAGE_API_KEY);
        }
        await db.transaction(async (tx) => {
          await tx
            .update(sources)
            .set({ status: 'ready', lastSyncedAt: new Date(), lastCommit: commit, lastError: graph.warnings.length ? `${graph.warnings.length} warning(s): ${graph.warnings.slice(0, 3).join(' | ')}` : null })
            .where(eq(sources.id, sourceId));
          await appendActivity(tx, {
            projectId: src.projectId,
            actorType: 'agent',
            agentKey: 'legacy_intelligence',
            type: 'source.synced',
            summary: `Indexed “${src.name}”: ${stats.objects} objects, ${stats.edges} dependencies`,
            data: { sourceId, ...stats, commit, warnings: graph.warnings.slice(0, 20) },
          });
          await publish(tx, { type: 'source.changed', projectId: src.projectId, sourceId });
        });
        return { ...stats, warnings: graph.warnings };
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        await db.transaction(async (tx) => {
          await tx.update(sources).set({ status: 'error', lastError: message.slice(0, 2000) }).where(eq(sources.id, sourceId));
          await appendActivity(tx, {
            projectId: src.projectId,
            actorType: 'system',
            type: 'source.failed',
            summary: `Could not index “${src.name}”: ${message.slice(0, 300)}`,
            data: { sourceId },
          });
          await publish(tx, { type: 'source.changed', projectId: src.projectId, sourceId });
        });
        throw err;
      }
    },
  };
}

async function collectFiles(root: string, include: string[], exclude: string[]): Promise<SourceFile[]> {
  const inc = include.length ? picomatch(include, { dot: false }) : null;
  const exc = picomatch(exclude, { dot: true });
  const out: SourceFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (exc(rel) || exc(`${rel}/`)) continue;
      if (e.isDirectory()) {
        if (e.name === '.git') continue;
        await walk(abs);
      } else if (e.isFile()) {
        if (inc && !inc(rel)) continue;
        const stat = await fs.stat(abs);
        if (stat.size > MAX_FILE_BYTES) continue;
        const buf = await fs.readFile(abs);
        out.push(isBinary(buf) ? { path: rel, content: null, binary: true } : { path: rel, content: buf.toString('utf8') });
      }
    }
  };
  await walk(root);
  return out;
}

/** Use a Graphify graph when one is present (graphify-out/graph.json) or can be produced by GRAPHIFY_CMD. */
async function graphifyGraph(dir: string, cmd: string | undefined): Promise<GraphResult | null> {
  if (cmd) {
    const [program, ...args] = cmd.split(/\s+/).map((a) => a.replace('{dir}', dir));
    if (program) {
      const r = await exec(program, args, { cwd: dir, timeoutMs: 900_000 });
      if (r.exitCode !== 0) return { objects: [], refs: [], warnings: [`Graphify failed: ${(r.stderr || r.stdout).slice(0, 300)}`] };
    }
  }
  for (const candidate of ['graphify-out/graph.json', 'graph.json']) {
    try {
      const text = await fs.readFile(path.join(dir, candidate), 'utf8');
      return graphFromGraphify(JSON.parse(text));
    } catch {
      /* not present */
    }
  }
  return null;
}

/**
 * Upsert this source's objects (replacing chunks only when content changed),
 * remove objects that disappeared, and rebuild the source's edges by resolving
 * references against every object in the project.
 */
export async function persistGraph(db: DbOrTx, projectId: string, sourceId: string, graph: GraphResult): Promise<{ objects: number; edges: number; chunks: number }> {
  let chunkCount = 0;
  const keep: string[] = [];
  // Objects in batches, each in its own transaction, to keep locks short on large repositories.
  for (let i = 0; i < graph.objects.length; i += 200) {
    const batch = graph.objects.slice(i, i + 200);
    await (db as { transaction: (fn: (tx: DbOrTx) => Promise<void>) => Promise<void> }).transaction(async (tx) => {
      for (const o of batch) {
        const [existing] = await tx
          .select({ id: codeObjects.id, hash: codeObjects.contentHash })
          .from(codeObjects)
          .where(and(eq(codeObjects.sourceId, sourceId), eq(codeObjects.kind, o.kind), eq(codeObjects.name, o.name)));
        let id: string;
        if (existing) {
          id = existing.id;
          await tx
            .update(codeObjects)
            .set({ path: o.path, language: o.language, summary: o.summary, metadata: o.metadata, contentHash: o.contentHash })
            .where(eq(codeObjects.id, id));
          if (existing.hash !== o.contentHash) {
            await tx.delete(chunks).where(eq(chunks.objectId, id));
            if (o.chunks.length) await tx.insert(chunks).values(o.chunks.map((c) => ({ projectId, objectId: id, ...c })));
          }
        } else {
          const [row] = await tx
            .insert(codeObjects)
            .values({ projectId, sourceId, kind: o.kind, name: o.name, path: o.path, language: o.language, summary: o.summary, metadata: o.metadata, contentHash: o.contentHash })
            .returning({ id: codeObjects.id });
          id = row!.id;
          if (o.chunks.length) await tx.insert(chunks).values(o.chunks.map((c) => ({ projectId, objectId: id, ...c })));
        }
        chunkCount += o.chunks.length;
        keep.push(id);
      }
    });
    heartbeat(`stored ${Math.min(i + 200, graph.objects.length)} of ${graph.objects.length} objects`);
  }
  if (keep.length) await db.delete(codeObjects).where(and(eq(codeObjects.sourceId, sourceId), notInArray(codeObjects.id, keep)));
  else await db.delete(codeObjects).where(eq(codeObjects.sourceId, sourceId));

  // Resolve references against all project objects.
  const all = await db.select({ id: codeObjects.id, kind: codeObjects.kind, name: codeObjects.name, sourceId: codeObjects.sourceId }).from(codeObjects).where(eq(codeObjects.projectId, projectId));
  const byName = new Map<string, { id: string; kind: string; sourceId: string }[]>();
  for (const o of all) {
    const arr = byName.get(o.name) ?? [];
    arr.push(o);
    byName.set(o.name, arr);
  }
  const edgeSet = new Map<string, { projectId: string; sourceId: string; fromId: string; toId: string; kind: string }>();
  for (const r of graph.refs) {
    const from = byName.get(r.from.name)?.find((o) => o.kind === r.from.kind && o.sourceId === sourceId);
    if (!from) continue;
    const candidates = byName.get(r.toName) ?? [];
    const to = r.toKinds.map((k) => candidates.find((c) => c.kind === k)).find(Boolean);
    if (!to || to.id === from.id) continue;
    edgeSet.set(`${from.id}|${to.id}|${r.kind}`, { projectId, sourceId, fromId: from.id, toId: to.id, kind: r.kind });
  }
  await db.delete(codeEdges).where(eq(codeEdges.sourceId, sourceId));
  const edges = [...edgeSet.values()];
  for (let i = 0; i < edges.length; i += 1000) {
    await db.insert(codeEdges).values(edges.slice(i, i + 1000)).onConflictDoNothing();
  }
  return { objects: keep.length, edges: edges.length, chunks: chunkCount };
}

/** Embed chunks that have no vector yet (Voyage AI, 1024 dimensions). */
async function embedMissing(db: DbOrTx, projectId: string, apiKey: string): Promise<void> {
  for (let round = 0; round < 200; round++) {
    const rows = await db
      .select({ id: chunks.id, content: chunks.content })
      .from(chunks)
      .where(and(eq(chunks.projectId, projectId), sql`${chunks.embedding} is null`))
      .limit(64);
    if (rows.length === 0) return;
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'voyage-code-3', input: rows.map((r) => r.content.slice(0, 16000)), input_type: 'document', output_dimension: EMBEDDING_DIMENSIONS }),
    });
    if (!res.ok) throw new Error(`Embedding request failed with ${res.status}`);
    const body = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    for (const d of body.data) {
      await db.update(chunks).set({ embedding: d.embedding }).where(inArray(chunks.id, [rows[d.index]!.id]));
    }
    heartbeat(`embedded ${(round + 1) * 64} chunks`);
  }
}
