import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseFormXml, parseReportXml } from './oracle-modules.js';
import { parsePlsqlFile } from './plsql.js';
import type { ChunkRecord, GraphResult, ObjectRecord, RefRecord, References } from './types.js';

export interface SourceFile {
  path: string;
  content: string | null;
  /** True when the file is binary (content is null). */
  binary?: boolean;
}

const PLSQL_EXT = new Set(['.sql', '.pks', '.pkb', '.pls', '.plb', '.prc', '.fnc', '.trg', '.vw', '.tab', '.ddl', '.pck', '.spc', '.bdy', '.seq']);
const CODE_EXT: Record<string, string> = {
  '.java': 'java',
  '.cs': 'csharp',
  '.vb': 'vbnet',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.kt': 'kotlin',
  '.cbl': 'cobol',
  '.cob': 'cobol',
  '.cpy': 'cobol',
  '.xml': 'xml',
  '.md': 'markdown',
  '.txt': 'text',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.properties': 'properties',
};

const TABLE_KINDS = ['db_table', 'db_view'];
const ROUTINE_KINDS = ['plsql_package', 'plsql_procedure', 'plsql_function'];

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Split text into overlapping line windows for search. */
export function chunkText(text: string, firstLine = 1, windowLines = 60, overlap = 10, maxChunks = 200): ChunkRecord[] {
  const lines = text.split('\n');
  const out: ChunkRecord[] = [];
  const step = Math.max(1, windowLines - overlap);
  for (let start = 0; start < lines.length && out.length < maxChunks; start += step) {
    const slice = lines.slice(start, start + windowLines);
    const content = slice.join('\n').trim();
    if (content) {
      out.push({ ordinal: out.length, content, startLine: firstLine + start, endLine: firstLine + start + slice.length - 1 });
    }
    if (start + windowLines >= lines.length) break;
  }
  return out;
}

function refsFrom(kind: string, name: string, refs: References): RefRecord[] {
  const from = { kind, name };
  const out: RefRecord[] = [];
  for (const t of refs.reads) out.push({ from, toName: t, toKinds: TABLE_KINDS, kind: 'reads' });
  for (const t of refs.writes) out.push({ from, toName: t, toKinds: TABLE_KINDS, kind: 'writes' });
  for (const c of refs.calls) {
    // PKG.PROC resolves to the package; a bare name to a procedure, function or package.
    const target = c.includes('.') ? c.split('.')[0]! : c;
    out.push({ from, toName: target, toKinds: ROUTINE_KINDS, kind: 'calls' });
  }
  return out;
}

function list(items: string[], max = 8): string {
  if (items.length === 0) return 'none';
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

/**
 * Turn a set of repository files into objects and references.
 * Package specs and bodies with the same name merge into one object.
 */
export function buildGraph(files: SourceFile[]): GraphResult {
  const objects = new Map<string, ObjectRecord>();
  const refs: RefRecord[] = [];
  const warnings: string[] = [];
  const put = (o: ObjectRecord) => {
    const k = `${o.kind}:${o.name}`;
    const existing = objects.get(k);
    if (!existing) {
      objects.set(k, o);
      return;
    }
    // Merge (package spec + body, or the same object defined twice).
    existing.metadata = { ...existing.metadata, ...o.metadata, paths: [...new Set([...(existing.metadata.paths as string[] ?? [existing.path]), o.path])] };
    const offset = existing.chunks.length;
    existing.chunks.push(...o.chunks.map((c) => ({ ...c, ordinal: c.ordinal + offset })));
    existing.contentHash = sha256(existing.contentHash + o.contentHash);
    if (o.summary.length > existing.summary.length) existing.summary = o.summary;
  };

  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    const base = path.basename(f.path);
    const lower = base.toLowerCase();
    try {
      if (f.binary || f.content === null) {
        if (ext === '.fmb' || ext === '.rdf' || ext === '.pll' || ext === '.mmb') {
          const kind = ext === '.rdf' ? 'oracle_report' : ext === '.fmb' ? 'oracle_form' : 'file';
          put({
            kind,
            name: base.replace(/\.[^.]+$/, '').toUpperCase(),
            path: f.path,
            language: 'oracle',
            summary: `Binary Oracle ${ext.slice(1).toUpperCase()} module. Convert it to XML (frmf2xml / rwconverter) so its contents can be analysed.`,
            metadata: { binary: true, needsConversion: true },
            chunks: [],
            contentHash: sha256(f.path),
          });
        }
        continue;
      }
      const content = f.content;
      if (PLSQL_EXT.has(ext)) {
        const units = parsePlsqlFile(content);
        if (units.length === 0) {
          put(fileObject(f.path, content, 'sql'));
          continue;
        }
        for (const u of units) {
          const summary = describeUnit(u.kind, u.name, u.members, u.refs, u.extra);
          put({
            kind: u.kind,
            name: u.name,
            path: f.path,
            language: 'plsql',
            summary,
            metadata: {
              schema: u.schema,
              members: u.members,
              reads: u.refs.reads,
              writes: u.refs.writes,
              calls: u.refs.calls,
              ...u.extra,
              lines: [u.startLine, u.endLine],
            },
            chunks: chunkText(u.text, u.startLine),
            contentHash: sha256(u.text),
          });
          refs.push(...refsFrom(u.kind, u.name, u.refs));
        }
      } else if (ext === '.xml' && (lower.endsWith('_fmb.xml') || content.includes('<FormModule'))) {
        const form = parseFormXml(content, base.replace(/(_fmb)?\.xml$/i, ''));
        if (!form) {
          warnings.push(`${f.path}: looks like a Forms export but no FormModule was found`);
          continue;
        }
        const code = [
          ...form.triggers.map((t) => `-- TRIGGER ${t.name} (${t.scope})\n${t.text}`),
          ...form.programUnits.map((p) => `-- PROGRAM UNIT ${p.name}\n${p.text}`),
          ...form.recordGroups.filter((r) => r.query).map((r) => `-- RECORD GROUP ${r.name}\n${r.query}`),
        ].join('\n\n');
        put({
          kind: 'oracle_form',
          name: form.name,
          path: f.path,
          language: 'oracle-forms',
          summary: `Oracle Form ${form.name} with ${form.blocks.length} block(s) (${list(form.blocks.map((b) => b.name))}); data sources ${list(form.blocks.map((b) => b.dataSource).filter((x): x is string => !!x))}; ${form.triggers.length} trigger(s), ${form.programUnits.length} program unit(s); calls ${list(form.refs.calls)}.`,
          metadata: {
            blocks: form.blocks,
            triggers: form.triggers.map((t) => ({ name: t.name, scope: t.scope, line: t.line })),
            programUnits: form.programUnits.map((p) => ({ name: p.name, type: p.type, line: p.line })),
            recordGroups: form.recordGroups,
            lovs: form.lovs,
            libraries: form.libraries,
            reads: form.refs.reads,
            writes: form.refs.writes,
            calls: form.refs.calls,
          },
          chunks: chunkText(code || content.slice(0, 20000)),
          contentHash: sha256(content),
        });
        refs.push(...refsFrom('oracle_form', form.name, form.refs));
        for (const b of form.blocks) {
          const blockName = `${form.name}.${b.name}`;
          put({
            kind: 'form_block',
            name: blockName,
            path: f.path,
            language: 'oracle-forms',
            summary: `Block ${b.name} of form ${form.name}; data source ${b.dataSource ?? 'none'}; items ${list(b.items.map((i) => i.name), 12)}.`,
            metadata: { form: form.name, ...b },
            chunks: [],
            contentHash: sha256(JSON.stringify(b)),
          });
          refs.push({ from: { kind: 'oracle_form', name: form.name }, toName: blockName, toKinds: ['form_block'], kind: 'contains' });
          if (b.dataSource) refs.push({ from: { kind: 'form_block', name: blockName }, toName: b.dataSource, toKinds: TABLE_KINDS, kind: 'reads' });
        }
      } else if (ext === '.xml' && (lower.endsWith('_rdf.xml') || /<report[\s>]/.test(content))) {
        const rep = parseReportXml(content, base.replace(/(_rdf)?\.xml$/i, ''));
        if (!rep) {
          warnings.push(`${f.path}: looks like a Reports export but no report element was found`);
          continue;
        }
        const code = [
          ...rep.queries.map((q) => `-- QUERY ${q.name}\n${q.sql}`),
          ...rep.programUnits.map((p) => `-- PROGRAM UNIT ${p.name}\n${p.text}`),
        ].join('\n\n');
        put({
          kind: 'oracle_report',
          name: rep.name,
          path: f.path,
          language: 'oracle-reports',
          summary: `Oracle Report ${rep.name} with ${rep.queries.length} quer${rep.queries.length === 1 ? 'y' : 'ies'} reading ${list(rep.refs.reads)}; ${rep.fields.length} layout field(s); parameters ${list(rep.parameters)}.`,
          metadata: {
            queries: rep.queries.map((q) => q.name),
            dataItems: rep.dataItems,
            fields: rep.fields,
            parameters: rep.parameters,
            programUnits: rep.programUnits.map((p) => p.name),
            reads: rep.refs.reads,
            calls: rep.refs.calls,
          },
          chunks: chunkText(code || content.slice(0, 20000)),
          contentHash: sha256(content),
        });
        refs.push(...refsFrom('oracle_report', rep.name, rep.refs));
      } else if (CODE_EXT[ext]) {
        put(fileObject(f.path, content, CODE_EXT[ext]!));
      }
    } catch (err) {
      warnings.push(`${f.path}: ${(err as Error).message}`);
    }
  }
  return { objects: [...objects.values()], refs, warnings };
}

function fileObject(p: string, content: string, language: string): ObjectRecord {
  return {
    kind: 'file',
    name: p,
    path: p,
    language,
    summary: `${language} file ${p} (${content.split('\n').length} lines)`,
    metadata: {},
    chunks: chunkText(content),
    contentHash: sha256(content),
  };
}

function describeUnit(kind: string, name: string, members: string[], refs: References, extra: Record<string, unknown>): string {
  switch (kind) {
    case 'plsql_package':
      return `PL/SQL package ${name}${members.length ? ` with ${members.length} routine(s): ${list(members)}` : ''}. Reads ${list(refs.reads)}; writes ${list(refs.writes)}; calls ${list(refs.calls)}.`;
    case 'db_table': {
      const cols = (extra.columns as { name: string }[] | undefined) ?? [];
      return `Table ${name} with ${cols.length} column(s): ${list(cols.map((c) => c.name), 15)}.`;
    }
    case 'db_view':
      return `View ${name} reading ${list(refs.reads)}.`;
    case 'plsql_trigger':
      return `Trigger ${name} ${extra.timing ? `(${String(extra.timing)}) ` : ''}on ${String(extra.onTable ?? 'unknown table')}; writes ${list(refs.writes)}; calls ${list(refs.calls)}.`;
    case 'db_sequence':
      return `Sequence ${name}.`;
    default:
      return `${kind === 'plsql_function' ? 'Function' : 'Procedure'} ${name}. Reads ${list(refs.reads)}; writes ${list(refs.writes)}; calls ${list(refs.calls)}.`;
  }
}
