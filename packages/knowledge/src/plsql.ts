import type { ParsedUnit, References } from './types.js';

/**
 * Deterministic PL/SQL and DDL scanner. It is not a full grammar: it finds
 * units (packages, procedures, functions, triggers, views, tables, sequences),
 * package members, and the tables and routines each unit reads, writes and calls.
 * That is what impact analysis needs, and it is fast and predictable.
 */

const KEYWORDS = new Set(
  `SELECT FROM WHERE AND OR NOT NULL IS IN INTO VALUES UPDATE SET DELETE INSERT MERGE USING ON WHEN THEN ELSE END IF LOOP FOR WHILE
  BEGIN DECLARE EXCEPTION RETURN RETURNING CURSOR OPEN FETCH CLOSE COMMIT ROLLBACK SAVEPOINT RAISE EXIT CONTINUE GOTO CASE AS IS OUT NOCOPY
  TYPE RECORD TABLE OF INDEX BY VARCHAR2 NUMBER DATE BOOLEAN INTEGER PLS_INTEGER BINARY_INTEGER CHAR CLOB BLOB ROWTYPE DUAL SYSDATE SYSTIMESTAMP
  USER ROWNUM ROWID LEVEL PRIOR CONNECT START WITH GROUP ORDER HAVING UNION ALL MINUS INTERSECT DISTINCT BETWEEN LIKE EXISTS ANY SOME JOIN LEFT RIGHT
  INNER OUTER FULL CROSS NATURAL ASC DESC NVL NVL2 DECODE COALESCE TO_CHAR TO_DATE TO_NUMBER TRUNC ROUND SUBSTR INSTR LENGTH UPPER LOWER TRIM LTRIM
  RTRIM REPLACE COUNT SUM MIN MAX AVG FIRST LAST EXECUTE IMMEDIATE BULK COLLECT LIMIT FORALL PRAGMA AUTONOMOUS_TRANSACTION SQLCODE SQLERRM
  DBMS_OUTPUT PUT_LINE RAISE_APPLICATION_ERROR NEW OLD CREATE REPLACE PACKAGE BODY PROCEDURE FUNCTION TRIGGER VIEW SEQUENCE DEFAULT CONSTANT`.split(/\s+/),
);

/** Blank out comments and string literals but keep line structure, so line numbers stay correct. */
export function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '-' && n === '-') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
    } else if (c === "'") {
      out += "'";
      i++;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") {
          out += '  ';
          i += 2;
        } else if (src[i] === "'") {
          break;
        } else {
          out += src[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
      out += "'";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const ID = `"?[A-Za-z][A-Za-z0-9_$#]*"?`;
const QUALIFIED = `(?:(${ID})\\s*\\.\\s*)?(${ID})`;
const clean = (s: string | undefined) => (s ? s.replace(/"/g, '').toUpperCase() : null);

/** Extract table reads/writes and routine calls from a block of PL/SQL or SQL. */
export function extractReferences(code: string): References {
  const text = stripCommentsAndStrings(code);
  const reads = new Set<string>();
  const writes = new Set<string>();
  const calls = new Set<string>();

  const add = (set: Set<string>, schema: string | undefined, name: string | undefined) => {
    const n = clean(name);
    if (!n || KEYWORDS.has(n)) return;
    set.add(n);
    void schema;
  };

  // FROM a, b x JOIN c: capture the first table after FROM/JOIN and comma-separated followers.
  for (const m of text.matchAll(new RegExp(`\\b(?:FROM|JOIN)\\s+${QUALIFIED}((?:\\s*(?:${ID})?\\s*,\\s*${QUALIFIED})*)`, 'gi'))) {
    add(reads, m[1], m[2]);
    const tail = m[3] ?? '';
    for (const t of tail.matchAll(new RegExp(`,\\s*${QUALIFIED}`, 'g'))) add(reads, t[1], t[2]);
  }
  for (const m of text.matchAll(new RegExp(`\\bINSERT\\s+(?:ALL\\s+)?INTO\\s+${QUALIFIED}`, 'gi'))) add(writes, m[1], m[2]);
  for (const m of text.matchAll(new RegExp(`\\bUPDATE\\s+${QUALIFIED}\\s+(?:${ID}\\s+)?SET\\b`, 'gi'))) add(writes, m[1], m[2]);
  for (const m of text.matchAll(new RegExp(`\\bDELETE\\s+(?:FROM\\s+)?${QUALIFIED}`, 'gi'))) add(writes, m[1], m[2]);
  for (const m of text.matchAll(new RegExp(`\\bMERGE\\s+INTO\\s+${QUALIFIED}`, 'gi'))) add(writes, m[1], m[2]);
  for (const m of text.matchAll(new RegExp(`\\b${QUALIFIED}\\s*%\\s*(?:ROWTYPE|TYPE)\\b`, 'gi'))) {
    // table%ROWTYPE and table.column%TYPE both reference the table
    add(reads, undefined, m[1] ?? m[2]);
  }

  // Calls: pkg.proc(...) and pkg.proc; plus bare proc(...) statements.
  for (const m of text.matchAll(new RegExp(`\\b(${ID})\\s*\\.\\s*(${ID})\\s*(?=\\(|;)`, 'g'))) {
    const pkg = clean(m[1]);
    const proc = clean(m[2]);
    if (pkg && proc && !KEYWORDS.has(pkg) && !KEYWORDS.has(proc) && !/^(DBMS_|UTL_|APEX_|OWA_|HTP|HTF)/.test(pkg)) calls.add(`${pkg}.${proc}`);
  }
  for (const m of text.matchAll(new RegExp(`(?:^|[;\\n]|\\bTHEN|\\bELSE|\\bBEGIN|\\bLOOP)\\s*(${ID})\\s*\\(`, 'gi'))) {
    const n = clean(m[1]);
    if (n && !KEYWORDS.has(n)) calls.add(n);
  }
  // Tables referenced by writes are also "touched"; keep reads free of pure writes only when never read.
  return { reads: [...reads].sort(), writes: [...writes].sort(), calls: [...calls].sort() };
}

const UNIT_RE = new RegExp(
  `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:(?:NON)?EDITIONABLE\\s+)?(?:FORCE\\s+)?(?:GLOBAL\\s+TEMPORARY\\s+)?` +
    `(PACKAGE\\s+BODY|PACKAGE|PROCEDURE|FUNCTION|TRIGGER|VIEW|TABLE|SEQUENCE|MATERIALIZED\\s+VIEW)\\s+${QUALIFIED}`,
  'gi',
);

const KIND_OF: Record<string, string> = {
  'PACKAGE BODY': 'plsql_package',
  PACKAGE: 'plsql_package',
  PROCEDURE: 'plsql_procedure',
  FUNCTION: 'plsql_function',
  TRIGGER: 'plsql_trigger',
  VIEW: 'db_view',
  'MATERIALIZED VIEW': 'db_view',
  TABLE: 'db_table',
  SEQUENCE: 'db_sequence',
};

function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Split a SQL/PL-SQL file into units. Text outside any CREATE is ignored. */
export function parsePlsqlFile(source: string): ParsedUnit[] {
  const stripped = stripCommentsAndStrings(source);
  const starts: { index: number; type: string; schema: string | null; name: string }[] = [];
  for (const m of stripped.matchAll(UNIT_RE)) {
    starts.push({ index: m.index!, type: m[1]!.toUpperCase().replace(/\s+/g, ' '), schema: clean(m[2]), name: clean(m[3])! });
  }
  const units: ParsedUnit[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]!.index : source.length;
    const text = source.slice(s.index, end).trimEnd();
    const body = stripped.slice(s.index, end);
    const kind = KIND_OF[s.type] ?? 'plsql_procedure';
    const members: string[] = [];
    const extra: Record<string, unknown> = { declaration: s.type };
    if (s.type === 'PACKAGE' || s.type === 'PACKAGE BODY') {
      for (const m of body.matchAll(new RegExp(`\\b(PROCEDURE|FUNCTION)\\s+(${ID})`, 'gi'))) {
        const n = clean(m[2])!;
        if (!members.includes(n)) members.push(n);
      }
    }
    if (s.type === 'TRIGGER') {
      const on = body.match(new RegExp(`\\bON\\s+${QUALIFIED}`, 'i'));
      if (on) extra.onTable = clean(on[2]);
      const timing = body.match(/\b(BEFORE|AFTER|INSTEAD\s+OF)\s+([A-Z ,]+?)\s+ON\b/i);
      if (timing) extra.timing = `${timing[1]!.toUpperCase()} ${timing[2]!.toUpperCase().trim()}`;
    }
    if (s.type === 'TABLE') {
      extra.columns = parseColumns(body);
    }
    const refs = s.type === 'TABLE' || s.type === 'SEQUENCE' ? { reads: [], writes: [], calls: [] } : extractReferences(text);
    if (s.type === 'TRIGGER' && extra.onTable) refs.reads = [...new Set([...refs.reads, extra.onTable as string])].sort();
    units.push({
      kind,
      name: s.name,
      schema: s.schema,
      startLine: lineAt(source, s.index),
      endLine: lineAt(source, end),
      text,
      members,
      refs: {
        ...refs,
        // A unit does not "call" itself or its own members.
        calls: refs.calls.filter((c) => c !== s.name && !members.includes(c) && !c.startsWith(`${s.name}.`)),
      },
      extra,
    });
  }
  return units;
}

/** Column names and types from a CREATE TABLE body. */
export function parseColumns(body: string): { name: string; type: string }[] {
  const open = body.indexOf('(');
  if (open === -1) return [];
  let depth = 0;
  let close = -1;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const inner = body.slice(open + 1, close === -1 ? undefined : close);
  const parts: string[] = [];
  depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter((p) => p && !/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i.test(p))
    .map((p) => {
      const m = p.match(new RegExp(`^(${ID})\\s+([A-Za-z0-9_]+(?:\\s*\\([^)]*\\))?)`));
      return m ? { name: clean(m[1])!, type: m[2]!.toUpperCase().replace(/\s+/g, '') } : null;
    })
    .filter((x): x is { name: string; type: string } => x !== null);
}
