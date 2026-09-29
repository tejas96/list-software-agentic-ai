import { rm } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { resolveProjectSettings, type ProjectSettings } from '@lsa/contracts';
import { OracleAdapter, Workspace, type OracleConnection } from '@lsa/adapters';
import { credentials, projects, runs, sources, tickets, type DbOrTx, type SecretBox } from '@lsa/db';
import type { WorkerConfig } from '../config.js';

export function runDir(config: WorkerConfig, runId: string): string {
  return path.join(config.workspacesRoot, 'runs', runId, 'repo');
}

export async function removeRunWorkspace(config: WorkerConfig, runId: string): Promise<void> {
  await rm(path.join(config.workspacesRoot, 'runs', runId), { recursive: true, force: true });
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
}

export async function decryptCredential(db: DbOrTx, box: SecretBox, credentialId: string | null | undefined): Promise<string | null> {
  if (!credentialId) return null;
  const [c] = await db.select().from(credentials).where(eq(credentials.id, credentialId));
  if (!c) return null;
  await db.update(credentials).set({ lastUsedAt: new Date() }).where(eq(credentials.id, credentialId));
  return box.decrypt(c.ciphertext);
}

/** The Git source agents work in: the configured one, else the project's first Git source. */
export async function workSource(db: DbOrTx, projectId: string, settings: ProjectSettings) {
  if (settings.workSourceId) {
    const [s] = await db.select().from(sources).where(and(eq(sources.id, settings.workSourceId), eq(sources.projectId, projectId)));
    if (s) return s;
  }
  const [first] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.projectId, projectId), eq(sources.kind, 'git')))
    .orderBy(asc(sources.createdAt))
    .limit(1);
  return first ?? null;
}

export interface RunEnvironment {
  workspace: Workspace | null;
  branch: string | null;
  baseRef: string | null;
  oracle: OracleAdapter;
  settings: ProjectSettings;
  gitToken: string | null;
  sourceUrl: string | null;
}

/**
 * Check out (or reopen) the run's work branch and build the Oracle adapter.
 * Called on the worker that owns the run's workspace (host-specific queue).
 */
export async function prepareRunEnvironment(db: DbOrTx, box: SecretBox, config: WorkerConfig, runId: string, needsWorkspace: boolean): Promise<RunEnvironment> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error(`Run ${runId} not found`);
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, run.ticketId));
  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId));
  const settings = resolveProjectSettings(run.config);
  const live = resolveProjectSettings(project!.settings);

  let sandbox: OracleConnection | null = null;
  const sandboxCfg = live.sandboxDb ?? settings.sandboxDb;
  if (sandboxCfg) {
    const secret = await decryptCredential(db, box, sandboxCfg.credentialId);
    if (secret) {
      const { user, password } = JSON.parse(secret) as { user: string; password: string };
      sandbox = { connectString: sandboxCfg.connectString, user, password };
    }
  }
  const oracle = new OracleAdapter({ formsBinDir: config.ORACLE_FORMS_BIN_DIR, reportsBinDir: config.ORACLE_REPORTS_BIN_DIR }, sandbox);

  const src = await workSource(db, run.projectId, settings);
  if (!src || !needsWorkspace) {
    return { workspace: null, branch: run.branch, baseRef: null, oracle, settings, gitToken: null, sourceUrl: null };
  }
  const cfg = src.config as { url: string; branch?: string };
  const token = await decryptCredential(db, box, src.credentialId);
  const base = settings.baseBranch || cfg.branch || 'main';
  const branch = run.branch ?? `lsa/${ticket!.key.toLowerCase()}-${slug(ticket!.title)}`;
  const workspace = await Workspace.checkout({
    dir: runDir(config, runId),
    url: cfg.url,
    baseBranch: base,
    workBranch: branch,
    token,
    policy: {
      allowedCommands: settings.allowedCommands,
      sandboxMode: config.SANDBOX_MODE,
      sandboxImage: config.SANDBOX_IMAGE,
      extraPath: [config.ORACLE_FORMS_BIN_DIR, config.ORACLE_REPORTS_BIN_DIR].filter((x): x is string => !!x),
    },
  });
  if (!run.branch) await db.update(runs).set({ branch }).where(eq(runs.id, runId));
  return { workspace, branch, baseRef: `origin/${base}`, oracle, settings, gitToken: token, sourceUrl: cfg.url };
}
