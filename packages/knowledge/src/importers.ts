import { chunkText, sha256 } from './graph.js';
import { parsePlsqlFile } from './plsql.js';
import type { EdgeKind, GraphResult, ObjectRecord, RefRecord } from './types.js';

/** Shape of an Oracle data-dictionary snapshot (see @lsa/adapters readOracleMetadata). */
export interface MetadataSnapshot {
  objects: {
    owner: string;
    name: string;
    type: string;
    status: string;
    source: string | null;
    columns: { name: string; dataType: string; nullable: boolean }[];
  }[];
  dependencies: {
    owner: string;
    name: string;
    type: string;
    refOwner: string;
    refName: string;
    refType: string;
  }[];
}

const KIND: Record<string, string> = {
  PACKAGE: 'plsql_package',
  'PACKAGE BODY': 'plsql_package',
  PROCEDURE: 'plsql_procedure',
  FUNCTION: 'plsql_function',
  TRIGGER: 'plsql_trigger',
  TABLE: 'db_table',
  VIEW: 'db_view',
  SEQUENCE: 'db_sequence',
};

/** Objects and dependencies read from the live data dictionary (ALL_OBJECTS, ALL_SOURCE, ALL_DEPENDENCIES). */
export function graphFromOracleMetadata(snapshot: MetadataSnapshot): GraphResult {
  const objects = new Map<string, ObjectRecord>();
  const refs: RefRecord[] = [];
  for (const o of snapshot.objects) {
    const kind = KIND[o.type];
    if (!kind) continue;
    const k = `${kind}:${o.name}`;
    const existing = objects.get(k);
    const source = o.source ?? '';
    const header =
      o.type === 'TABLE'
        ? `${o.owner}.${o.name}\n${o.columns.map((c) => `${c.name} ${c.dataType}${c.nullable ? '' : ' NOT NULL'}`).join('\n')}`
        : source;
    const record: ObjectRecord = existing ?? {
      kind,
      name: o.name,
      path: null,
      language: o.type === 'TABLE' || o.type === 'VIEW' || o.type === 'SEQUENCE' ? 'sql' : 'plsql',
      summary: '',
      metadata: { schema: o.owner, status: o.status, types: [] as string[] },
      chunks: [],
      contentHash: '',
    };
    (record.metadata.types as string[]).push(o.type);
    if (o.status !== 'VALID') record.metadata.invalid = true;
    if (o.columns.length) record.metadata.columns = o.columns;
    if (source) {
      const members =
        parsePlsqlFile(
          `CREATE ${o.type} ${o.name} ${source.replace(/^\s*(PACKAGE\s+BODY|PACKAGE|PROCEDURE|FUNCTION|TRIGGER)\s+\S+/i, '')}`,
        )[0]?.members ?? [];
      if (members.length)
        record.metadata.members = [
          ...new Set([...((record.metadata.members as string[]) ?? []), ...members]),
        ];
    }
    const offset = record.chunks.length;
    record.chunks.push(...chunkText(header).map((c) => ({ ...c, ordinal: c.ordinal + offset })));
    record.contentHash = sha256(record.contentHash + header);
    record.summary =
      kind === 'db_table'
        ? `Table ${o.owner}.${o.name} with ${o.columns.length} column(s)${
            o.columns.length
              ? `: ${o.columns
                  .slice(0, 15)
                  .map((c) => c.name)
                  .join(', ')}`
              : ''
          }.`
        : `${o.type.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} ${o.owner}.${o.name}${o.status !== 'VALID' ? ' (INVALID in the database)' : ''}.`;
    objects.set(k, record);
  }
  for (const d of snapshot.dependencies) {
    const fromKind = KIND[d.type];
    const toKind = KIND[d.refType];
    if (!fromKind || !toKind || (d.name === d.refName && fromKind === toKind)) continue;
    const kind: EdgeKind =
      toKind === 'db_table' || toKind === 'db_view'
        ? 'reads'
        : toKind === 'db_sequence'
          ? 'references'
          : 'calls';
    refs.push({ from: { kind: fromKind, name: d.name }, toName: d.refName, toKinds: [toKind], kind });
  }
  return { objects: [...objects.values()], refs, warnings: [] };
}

interface GraphifyNode {
  id?: string | number;
  label?: string;
  name?: string;
  type?: string;
  kind?: string;
  file?: string;
  source_file?: string;
  path?: string;
  docstring?: string;
  summary?: string;
}
interface GraphifyLink {
  source?: string | number | { id?: string | number };
  target?: string | number | { id?: string | number };
  relation?: string;
  type?: string;
  label?: string;
}

const RELATION: Record<string, EdgeKind> = {
  calls: 'calls',
  call: 'calls',
  imports: 'imports',
  import: 'imports',
  contains: 'contains',
  defines: 'contains',
  inherits: 'references',
  extends: 'references',
  implements: 'references',
  uses: 'references',
  references: 'references',
};

/**
 * Import a Graphify graph.json (node-link format) for languages Graphify
 * parses well (Java, C#, TypeScript, Python and others). Unknown fields are
 * ignored, so minor format changes do not break ingestion.
 */
export function graphFromGraphify(json: unknown): GraphResult {
  const warnings: string[] = [];
  const g = json as { nodes?: GraphifyNode[]; links?: GraphifyLink[]; edges?: GraphifyLink[] };
  if (!g || !Array.isArray(g.nodes))
    return { objects: [], refs: [], warnings: ['graph.json has no "nodes" array'] };
  const byId = new Map<string, { kind: string; name: string }>();
  const objects: ObjectRecord[] = [];
  for (const n of g.nodes) {
    const id = String(n.id ?? n.name ?? n.label ?? '');
    if (!id) continue;
    const type = String(n.type ?? n.kind ?? 'module').toLowerCase();
    const kind =
      type.includes('class') || type.includes('interface')
        ? 'class'
        : type.includes('func') || type.includes('method')
          ? 'function'
          : type.includes('file')
            ? 'file'
            : 'module';
    const name = String(n.label ?? n.name ?? id);
    const file = n.file ?? n.source_file ?? n.path ?? null;
    const identity = { kind, name: file && kind !== 'file' ? `${file}#${name}` : name };
    byId.set(id, identity);
    const text = [n.summary, n.docstring].filter(Boolean).join('\n');
    objects.push({
      kind,
      name: identity.name,
      path: file,
      language: null,
      summary: text || `${kind} ${name}${file ? ` in ${file}` : ''}`,
      metadata: { graphifyId: id, graphifyType: type },
      chunks: text ? chunkText(text) : [],
      contentHash: sha256(JSON.stringify(n)),
    });
  }
  const refs: RefRecord[] = [];
  for (const l of g.links ?? g.edges ?? []) {
    const sid = typeof l.source === 'object' ? l.source?.id : l.source;
    const tid = typeof l.target === 'object' ? l.target?.id : l.target;
    const from = byId.get(String(sid));
    const to = byId.get(String(tid));
    if (!from || !to) continue;
    const rel = String(l.relation ?? l.type ?? l.label ?? 'references').toLowerCase();
    refs.push({ from, toName: to.name, toKinds: [to.kind], kind: RELATION[rel] ?? 'references' });
  }
  if (objects.length === 0) warnings.push('graph.json contained no usable nodes');
  return { objects, refs, warnings };
}
