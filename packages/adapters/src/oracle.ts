import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from './process.js';
import { WorkspaceError, type Workspace } from './workspace.js';

export interface OracleToolingConfig {
  /** Directory holding frmf2xml, frmxml2f and frmcmp_batch (Oracle Forms). */
  formsBinDir?: string | null;
  /** Directory holding rwconverter (Oracle Reports). */
  reportsBinDir?: string | null;
}

export interface OracleConnection {
  connectString: string;
  user: string;
  password: string;
}

export class OracleUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OracleUnavailableError';
  }
}

type OracleDbModule = typeof import('oracledb');
let oracledbPromise: Promise<OracleDbModule> | null = null;
async function oracledb(): Promise<OracleDbModule> {
  // Thin mode: pure JavaScript, no Oracle Instant Client needed.
  oracledbPromise ??= import('oracledb').then((m) => ((m as unknown as { default?: OracleDbModule }).default ?? m));
  return oracledbPromise;
}

/**
 * Oracle technology adapter: converts binary Forms and Reports modules to
 * editable XML and back, compiles them, and runs SQL against a sandbox schema.
 * Every operation reports clearly when the tooling is not installed.
 */
export class OracleAdapter {
  constructor(
    private readonly tooling: OracleToolingConfig,
    private readonly sandbox: OracleConnection | null,
  ) {}

  get capabilities() {
    return { forms: Boolean(this.tooling.formsBinDir), reports: Boolean(this.tooling.reportsBinDir), sandboxDb: Boolean(this.sandbox) };
  }

  private bin(kind: 'forms' | 'reports', program: string): string {
    const dir = kind === 'forms' ? this.tooling.formsBinDir : this.tooling.reportsBinDir;
    if (!dir) {
      throw new OracleUnavailableError(
        `Oracle ${kind === 'forms' ? 'Forms' : 'Reports'} tooling is not installed on this runner (set ${kind === 'forms' ? 'ORACLE_FORMS_BIN_DIR' : 'ORACLE_REPORTS_BIN_DIR'}). Report this as a blocker instead of guessing.`,
      );
    }
    return path.join(dir, program);
  }

  private userid(): string {
    if (!this.sandbox) throw new OracleUnavailableError('No sandbox database is configured for this project');
    return `${this.sandbox.user}/${this.sandbox.password}@${this.sandbox.connectString}`;
  }

  /** CUSTOMER_ACCOUNT.fmb → CUSTOMER_ACCOUNT_fmb.xml (next to the module). */
  async formToXml(ws: Workspace, fmbPath: string): Promise<{ xmlPath: string; log: string }> {
    const abs = await ws.resolve(fmbPath, true);
    const r = await exec(this.bin('forms', 'frmf2xml'), ['OVERWRITE=YES', path.basename(abs)], { cwd: path.dirname(abs), timeoutMs: 300_000 });
    const xml = abs.replace(/\.fmb$/i, '_fmb.xml');
    await assertCreated(xml, r.stdout + r.stderr, 'frmf2xml');
    return { xmlPath: ws.rel(xml), log: tail(r.stdout + r.stderr) };
  }

  /** CUSTOMER_ACCOUNT_fmb.xml → CUSTOMER_ACCOUNT.fmb. */
  async xmlToForm(ws: Workspace, xmlPath: string): Promise<{ fmbPath: string; log: string }> {
    const abs = await ws.resolve(xmlPath, true);
    const r = await exec(this.bin('forms', 'frmxml2f'), ['OVERWRITE=YES', path.basename(abs)], { cwd: path.dirname(abs), timeoutMs: 300_000 });
    const fmb = abs.replace(/_fmb\.xml$/i, '.fmb');
    await assertCreated(fmb, r.stdout + r.stderr, 'frmxml2f');
    return { fmbPath: ws.rel(fmb), log: tail(r.stdout + r.stderr) };
  }

  /** Compile a form against the sandbox schema. Returns the compiler log; success means an .fmx was produced. */
  async compileForm(ws: Workspace, fmbPath: string): Promise<{ ok: boolean; log: string }> {
    const abs = await ws.resolve(fmbPath, true);
    const cwd = path.dirname(abs);
    const r = await exec(
      this.bin('forms', 'frmcmp_batch'),
      [`module=${path.basename(abs)}`, `userid=${this.userid()}`, 'module_type=form', 'compile_all=yes', 'batch=yes', 'window_state=minimize'],
      { cwd, timeoutMs: 600_000 },
    );
    const errFile = abs.replace(/\.fmb$/i, '.err');
    const errText = await fs.readFile(errFile, 'utf8').catch(() => '');
    const fmx = abs.replace(/\.fmb$/i, '.fmx');
    const ok = await fs
      .access(fmx)
      .then(() => r.exitCode === 0)
      .catch(() => false);
    return { ok, log: this.redact(tail(errText || r.stdout + r.stderr)) };
  }

  /** Convert a report between binary (.rdf) and XML. */
  async convertReport(ws: Workspace, sourcePath: string, to: 'xml' | 'rdf'): Promise<{ outputPath: string; log: string }> {
    const abs = await ws.resolve(sourcePath, true);
    const dest = to === 'xml' ? abs.replace(/\.rdf$/i, '_rdf.xml') : abs.replace(/_rdf\.xml$/i, '.rdf');
    const stype = to === 'xml' ? 'rdffile' : 'xmlfile';
    const dtype = to === 'xml' ? 'xmlfile' : 'rdffile';
    const r = await exec(
      this.bin('reports', 'rwconverter'),
      [`source=${path.basename(abs)}`, `stype=${stype}`, `dest=${path.basename(dest)}`, `dtype=${dtype}`, 'batch=yes', 'overwrite=yes'],
      { cwd: path.dirname(abs), timeoutMs: 300_000 },
    );
    await assertCreated(dest, r.stdout + r.stderr, 'rwconverter');
    return { outputPath: ws.rel(dest), log: tail(r.stdout + r.stderr) };
  }

  /**
   * Run SQL or a PL/SQL block against the sandbox schema. Statements run one
   * at a time; a SELECT returns up to `maxRows` rows. Never used against production.
   */
  async runSql(
    statement: string,
    binds: Record<string, string | number | null> = {},
    maxRows = 200,
  ): Promise<{ rows?: Record<string, unknown>[]; rowsAffected?: number; columns?: string[] }> {
    if (!this.sandbox) throw new OracleUnavailableError('No sandbox database is configured for this project');
    const db = await oracledb();
    const conn = await db.getConnection({ user: this.sandbox.user, password: this.sandbox.password, connectString: this.sandbox.connectString });
    try {
      const res = await conn.execute(normaliseStatement(statement), binds, { outFormat: db.OUT_FORMAT_OBJECT, maxRows, autoCommit: true });
      return {
        rows: res.rows as Record<string, unknown>[] | undefined,
        rowsAffected: res.rowsAffected,
        columns: res.metaData?.map((m) => m.name),
      };
    } finally {
      await conn.close();
    }
  }

  /** Describe a database object in the sandbox: its type and status, columns and dependencies. */
  async describe(owner: string | null, name: string): Promise<Record<string, unknown>> {
    const binds = { name: name.toUpperCase(), owner: owner ? owner.toUpperCase() : null };
    const ownerClause = 'and (:owner is null or owner = :owner)';
    const objects = await this.runSql(`select owner, object_name, object_type, status, last_ddl_time from all_objects where object_name = :name ${ownerClause}`, binds);
    const columns = await this.runSql(
      `select column_name, data_type, data_length, nullable from all_tab_columns where table_name = :name ${ownerClause} order by column_id`,
      binds,
      500,
    );
    const deps = await this.runSql(
      `select owner, name, type, referenced_owner, referenced_name, referenced_type from all_dependencies where (name = :name or referenced_name = :name) ${ownerClause}`,
      binds,
      500,
    );
    return { objects: objects.rows, columns: columns.rows, dependencies: deps.rows };
  }

  private redact(text: string): string {
    return this.sandbox ? text.split(this.sandbox.password).join('***') : text;
  }
}

async function assertCreated(file: string, log: string, tool: string): Promise<void> {
  try {
    await fs.access(file);
  } catch {
    throw new WorkspaceError(`${tool} did not produce ${path.basename(file)}. Output: ${tail(log)}`);
  }
}

/** Oracle's driver takes one statement without a trailing ";" or "/", except PL/SQL blocks which keep their final ";". */
export function normaliseStatement(statement: string): string {
  let text = statement.trim().replace(/\n\/\s*$/, '').trim();
  const isPlsql = /^(begin|declare|create\s+(or\s+replace\s+)?(editionable\s+)?(package|procedure|function|trigger|type))\b/i.test(text);
  if (!isPlsql) text = text.replace(/;\s*$/, '');
  return text;
}

function tail(text: string, max = 4000): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

/* ------------------------------------------------ metadata extraction */

export interface OracleMetadataObject {
  owner: string;
  name: string;
  type: string;
  status: string;
  source: string | null;
  columns: { name: string; dataType: string; nullable: boolean }[];
}

export interface OracleMetadataSnapshot {
  objects: OracleMetadataObject[];
  dependencies: { owner: string; name: string; type: string; refOwner: string; refName: string; refType: string }[];
}

/** Read objects, source and dependencies for the given schemas (read-only queries). */
export async function readOracleMetadata(conn: OracleConnection, schemas: string[]): Promise<OracleMetadataSnapshot> {
  const db = await oracledb();
  const c = await db.getConnection({ user: conn.user, password: conn.password, connectString: conn.connectString });
  try {
    const owners = schemas.map((s) => s.toUpperCase());
    const binds = Object.fromEntries(owners.map((o, i) => [`o${i}`, o]));
    const inList = owners.map((_, i) => `:o${i}`).join(',');
    const opts = { outFormat: db.OUT_FORMAT_OBJECT, maxRows: 0 };
    const objs = await c.execute<{ OWNER: string; OBJECT_NAME: string; OBJECT_TYPE: string; STATUS: string }>(
      `select owner, object_name, object_type, status from all_objects
       where owner in (${inList}) and object_type in ('PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','TRIGGER','TABLE','VIEW','SEQUENCE')`,
      binds,
      opts,
    );
    const src = await c.execute<{ OWNER: string; NAME: string; TYPE: string; LINE: number; TEXT: string }>(
      `select owner, name, type, line, text from all_source where owner in (${inList}) order by owner, name, type, line`,
      binds,
      opts,
    );
    const cols = await c.execute<{ OWNER: string; TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string; NULLABLE: string }>(
      `select owner, table_name, column_name, data_type, nullable from all_tab_columns where owner in (${inList}) order by owner, table_name, column_id`,
      binds,
      opts,
    );
    const deps = await c.execute<{ OWNER: string; NAME: string; TYPE: string; REFERENCED_OWNER: string; REFERENCED_NAME: string; REFERENCED_TYPE: string }>(
      `select owner, name, type, referenced_owner, referenced_name, referenced_type from all_dependencies
       where owner in (${inList}) and referenced_owner in (${inList})`,
      binds,
      opts,
    );
    const key = (o: string, n: string, t: string) => `${o}.${n}.${t}`;
    const sourceMap = new Map<string, string[]>();
    for (const r of src.rows ?? []) {
      const k = key(r.OWNER, r.NAME, r.TYPE);
      const arr = sourceMap.get(k) ?? [];
      arr.push(r.TEXT);
      sourceMap.set(k, arr);
    }
    const colMap = new Map<string, OracleMetadataObject['columns']>();
    for (const r of cols.rows ?? []) {
      const k = `${r.OWNER}.${r.TABLE_NAME}`;
      const arr = colMap.get(k) ?? [];
      arr.push({ name: r.COLUMN_NAME, dataType: r.DATA_TYPE, nullable: r.NULLABLE === 'Y' });
      colMap.set(k, arr);
    }
    return {
      objects: (objs.rows ?? []).map((o) => ({
        owner: o.OWNER,
        name: o.OBJECT_NAME,
        type: o.OBJECT_TYPE,
        status: o.STATUS,
        source: sourceMap.get(key(o.OWNER, o.OBJECT_NAME, o.OBJECT_TYPE))?.join('') ?? null,
        columns: colMap.get(`${o.OWNER}.${o.OBJECT_NAME}`) ?? [],
      })),
      dependencies: (deps.rows ?? []).map((d) => ({
        owner: d.OWNER,
        name: d.NAME,
        type: d.TYPE,
        refOwner: d.REFERENCED_OWNER,
        refName: d.REFERENCED_NAME,
        refType: d.REFERENCED_TYPE,
      })),
    };
  } finally {
    await c.close();
  }
}
