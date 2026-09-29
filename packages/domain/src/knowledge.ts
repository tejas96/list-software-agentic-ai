import { and, eq, inArray, sql } from 'drizzle-orm';
import { codeObjects, type DbOrTx } from '@lsa/db';

export interface KnowledgeHit {
  id: string;
  name: string;
  kind: string;
  path: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  snippet: string;
  score: number;
}

/**
 * Hybrid search over the project knowledge graph: full-text on object names,
 * summaries and code chunks, fuzzy name similarity, and (when embeddings
 * exist) vector similarity. Used by the API and by agents, so both see the same results.
 */
export async function searchKnowledge(
  db: DbOrTx,
  projectId: string,
  query: string,
  options: { kind?: string; limit?: number; embedding?: number[] | null } = {},
): Promise<KnowledgeHit[]> {
  const limit = options.limit ?? 20;
  const kindFilter = options.kind ? sql`and o.kind = ${options.kind}` : sql``;
  const vec = options.embedding?.length ? `[${options.embedding.join(',')}]` : null;
  const res = await db.execute<{ id: string; score: number; snippet: string | null }>(sql`
    with q as (select websearch_to_tsquery('simple', ${query}) as tsq, upper(${query}) as uq),
    obj as (
      select o.id, ts_rank(o.search_vector, q.tsq) * 2 + similarity(o.name, q.uq) * 3 as score, null::text as snippet
      from code_objects o, q
      where o.project_id = ${projectId} ${kindFilter}
        and (o.search_vector @@ q.tsq or o.name % q.uq or o.name ilike '%' || q.uq || '%')
    ),
    chk as (
      select c.object_id as id, max(ts_rank(c.search_vector, q.tsq)) as score,
        (array_agg(ts_headline('simple', c.content, q.tsq, 'MaxFragments=1,MaxWords=30,MinWords=8') order by ts_rank(c.search_vector, q.tsq) desc))[1] as snippet
      from chunks c join code_objects o on o.id = c.object_id, q
      where c.project_id = ${projectId} and c.search_vector @@ q.tsq ${kindFilter}
      group by c.object_id
    ),
    vec as (
      select c.object_id as id, max(1 - (c.embedding <=> ${vec}::vector)) * 2 as score, null::text as snippet
      from chunks c join code_objects o on o.id = c.object_id
      where ${vec}::text is not null and c.project_id = ${projectId} and c.embedding is not null ${kindFilter}
      group by c.object_id
      order by score desc limit 50
    )
    select id, sum(score)::float as score, max(snippet) as snippet
    from (select * from obj union all select * from chk union all select * from vec) u
    group by id order by score desc limit ${limit}`);
  if (res.rows.length === 0) return [];
  const objs = await db
    .select()
    .from(codeObjects)
    .where(
      inArray(
        codeObjects.id,
        res.rows.map((r) => r.id),
      ),
    );
  const byId = new Map(objs.map((o) => [o.id, o]));
  return res.rows
    .filter((r) => byId.has(r.id))
    .map((r) => {
      const o = byId.get(r.id)!;
      return {
        id: o.id,
        name: o.name,
        kind: o.kind,
        path: o.path,
        summary: o.summary,
        metadata: o.metadata,
        snippet: r.snippet ?? o.summary ?? '',
        score: Number(r.score),
      };
    });
}

/** An object by exact name (case-insensitive for Oracle names), with its source text. */
export async function knowledgeObjectByName(db: DbOrTx, projectId: string, name: string) {
  const rows = await db
    .select()
    .from(codeObjects)
    .where(
      and(
        eq(codeObjects.projectId, projectId),
        sql`(${codeObjects.name} = ${name} or ${codeObjects.name} = upper(${name}))`,
      ),
    )
    .limit(5);
  if (rows.length === 0) return null;
  // Prefer the richest definition (a parsed module over a binary placeholder).
  const o = rows.sort((a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0))[0]!;
  const text = await db.execute<{ content: string }>(
    sql`select content from chunks where object_id = ${o.id} order by ordinal limit 40`,
  );
  return {
    id: o.id,
    name: o.name,
    kind: o.kind,
    path: o.path,
    summary: o.summary,
    metadata: o.metadata,
    content: text.rows.map((r) => r.content).join('\n…\n'),
  };
}

/** Dependencies of an object, walking up to `depth` hops. */
export async function knowledgeDependencies(
  db: DbOrTx,
  projectId: string,
  name: string,
  direction: 'uses' | 'used_by' | 'both',
  depth: number,
) {
  const d = Math.max(1, Math.min(3, depth));
  const res = await db.execute<{
    from_name: string;
    from_kind: string;
    to_name: string;
    to_kind: string;
    kind: string;
  }>(sql`
    with recursive start as (
      select id from code_objects where project_id = ${projectId} and (name = ${name} or name = upper(${name}))
    ),
    walk(id, lvl) as (
      select id, 0 from start
      union
      select case when e.from_id = w.id then e.to_id else e.from_id end, w.lvl + 1
      from walk w join code_edges e on
        (${direction} in ('uses','both') and e.from_id = w.id) or (${direction} in ('used_by','both') and e.to_id = w.id)
      where w.lvl < ${d}
    )
    select distinct f.name as from_name, f.kind as from_kind, t.name as to_name, t.kind as to_kind, e.kind
    from code_edges e
    join code_objects f on f.id = e.from_id
    join code_objects t on t.id = e.to_id
    where e.project_id = ${projectId}
      and ((${direction} in ('uses','both') and e.from_id in (select id from walk))
        or (${direction} in ('used_by','both') and e.to_id in (select id from walk)))
    limit 300`);
  return res.rows.map((r) => ({
    from: r.from_name,
    fromKind: r.from_kind,
    to: r.to_name,
    toKind: r.to_kind,
    kind: r.kind,
  }));
}
