import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { exec, type ExecResult } from './process.js';

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface WorkspacePolicy {
  /** Executables agents may run (matched on the program name). */
  allowedCommands: string[];
  /** `local` runs on the worker host; `docker` runs each command in a throwaway container. */
  sandboxMode: 'local' | 'docker';
  sandboxImage: string;
  /** Extra directories added to PATH (e.g. Oracle Forms bin). */
  extraPath?: string[];
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
]);
const MAX_READ_BYTES = 400_000;

/**
 * A checked-out repository an agent works in. Every path is confined to the
 * root (after resolving symlinks), commands are allow-listed and run without
 * a shell, and file reads are tracked so edits to changed files are refused.
 */
export class Workspace {
  private readonly readHashes = new Map<string, string>();

  constructor(
    public readonly root: string,
    private readonly policy: WorkspacePolicy,
  ) {}

  /** Resolve a model-supplied path inside the root, or throw. */
  async resolve(relPath: string, mustExist = false): Promise<string> {
    if (typeof relPath !== 'string' || relPath.includes('\0')) throw new WorkspaceError('Invalid path');
    const target = path.resolve(this.root, relPath.replace(/^\/+/, ''));
    const rootReal = await fs.realpath(this.root);
    const rel = path.relative(this.root, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new WorkspaceError(`Path "${relPath}" is outside the workspace`);
    }
    // Resolve symlinks of the deepest existing ancestor so links cannot escape the root.
    let probe = target;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        const r = path.relative(rootReal, real);
        if (r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) {
          throw new WorkspaceError(`Path "${relPath}" resolves outside the workspace`);
        }
        break;
      } catch (err) {
        if (err instanceof WorkspaceError) throw err;
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    if (mustExist) {
      try {
        await fs.access(target);
      } catch {
        throw new WorkspaceError(`"${relPath}" does not exist`);
      }
    }
    return target;
  }

  rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  async listFiles(dir = '.', glob?: string, limit = 400): Promise<{ files: string[]; truncated: boolean }> {
    const start = await this.resolve(dir, true);
    const match = glob ? picomatch(glob, { dot: false, nocase: true }) : null;
    const files: string[] = [];
    let truncated = false;
    const walk = async (d: string): Promise<void> => {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const entries = await fs.readdir(d, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (files.length >= limit) {
          truncated = true;
          return;
        }
        const abs = path.join(d, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(abs);
        } else if (e.isFile()) {
          const r = this.rel(abs);
          if (!match || match(r) || match(e.name)) files.push(r);
        }
      }
    };
    await walk(start);
    return { files, truncated };
  }

  async readFile(
    relPath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<{ path: string; content: string; totalLines: number; truncated: boolean }> {
    const abs = await this.resolve(relPath, true);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new WorkspaceError(`"${relPath}" is not a file`);
    const buf = await fs.readFile(abs);
    if (isBinary(buf))
      throw new WorkspaceError(
        `"${relPath}" is a binary file. Convert it first (for Oracle Forms use oracle_form_to_xml).`,
      );
    const text = buf.toString('utf8');
    this.readHashes.set(abs, sha(text));
    const lines = text.split('\n');
    const s = Math.max(1, startLine ?? 1);
    const e = Math.min(lines.length, endLine ?? lines.length);
    let content = lines
      .slice(s - 1, e)
      .map((l, i) => `${String(s + i).padStart(5)}  ${l}`)
      .join('\n');
    let truncated = false;
    if (content.length > MAX_READ_BYTES) {
      content = content.slice(0, MAX_READ_BYTES);
      truncated = true;
    }
    return { path: this.rel(abs), content, totalLines: lines.length, truncated };
  }

  /** Plain file text without line numbers (for parsers and diffs). */
  async readText(relPath: string): Promise<string> {
    const abs = await this.resolve(relPath, true);
    return fs.readFile(abs, 'utf8');
  }

  async searchFiles(
    pattern: string,
    glob?: string,
    limit = 200,
  ): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }> {
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      throw new WorkspaceError('The search pattern is not a valid regular expression');
    }
    const { files } = await this.listFiles('.', glob, 20_000);
    const matches: { path: string; line: number; text: string }[] = [];
    for (const f of files) {
      if (matches.length >= limit) return { matches, truncated: true };
      const abs = path.join(this.root, f);
      const stat = await fs.stat(abs);
      if (stat.size > 5_000_000) continue;
      const buf = await fs.readFile(abs);
      if (isBinary(buf)) continue;
      const lines = buf.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          matches.push({ path: f, line: i + 1, text: lines[i]!.slice(0, 300) });
          if (matches.length >= limit) return { matches, truncated: true };
        }
      }
    }
    return { matches, truncated: false };
  }

  async writeFile(relPath: string, content: string): Promise<{ path: string; created: boolean }> {
    const abs = await this.resolve(relPath);
    let created = true;
    try {
      const current = await fs.readFile(abs, 'utf8');
      created = false;
      const known = this.readHashes.get(abs);
      if (known && known !== sha(current)) {
        throw new WorkspaceError(`"${relPath}" changed since you read it. Read it again before writing.`);
      }
    } catch (err) {
      if (err instanceof WorkspaceError) throw err;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    this.readHashes.set(abs, sha(content));
    return { path: this.rel(abs), created };
  }

  /** Replace one exact, unique occurrence of `oldText`. */
  async editFile(relPath: string, oldText: string, newText: string): Promise<{ path: string }> {
    const abs = await this.resolve(relPath, true);
    const current = await fs.readFile(abs, 'utf8');
    const known = this.readHashes.get(abs);
    if (!known) throw new WorkspaceError(`Read "${relPath}" before editing it.`);
    if (known !== sha(current))
      throw new WorkspaceError(`"${relPath}" changed since you read it. Read it again before editing.`);
    const first = current.indexOf(oldText);
    if (oldText.length === 0 || first === -1)
      throw new WorkspaceError(
        'The text to replace was not found. Copy it exactly from the file, without line numbers.',
      );
    if (current.indexOf(oldText, first + 1) !== -1)
      throw new WorkspaceError(
        'The text to replace appears more than once. Include more surrounding lines to make it unique.',
      );
    const next = current.slice(0, first) + newText + current.slice(first + oldText.length);
    await fs.writeFile(abs, next, 'utf8');
    this.readHashes.set(abs, sha(next));
    return { path: this.rel(abs) };
  }

  async deleteFile(relPath: string): Promise<void> {
    const abs = await this.resolve(relPath, true);
    await fs.rm(abs);
    this.readHashes.delete(abs);
  }

  /** Run an allow-listed program in the workspace. */
  async run(program: string, args: string[], timeoutMs = 300_000): Promise<ExecResult> {
    const base = path.basename(program);
    if (program !== base) throw new WorkspaceError('Give the program name only, without a path');
    if (!this.policy.allowedCommands.includes(base)) {
      throw new WorkspaceError(
        `"${base}" is not an allowed command in this project. Allowed: ${this.policy.allowedCommands.join(', ')}`,
      );
    }
    if (args.some((a) => typeof a !== 'string' || a.includes('\0')))
      throw new WorkspaceError('Invalid argument');
    if (
      base === 'git' &&
      ['push', 'remote', 'config', 'credential', 'filter-branch'].includes(args[0] ?? '')
    ) {
      throw new WorkspaceError(`"git ${args[0]}" is handled by the platform, not by agents`);
    }
    const PATH = [...(this.policy.extraPath ?? []), process.env.PATH ?? '']
      .filter(Boolean)
      .join(path.delimiter);
    if (this.policy.sandboxMode === 'docker') {
      return exec(
        'docker',
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--cpus',
          '2',
          '--memory',
          '2g',
          '-v',
          `${this.root}:/workspace`,
          '-w',
          '/workspace',
          this.policy.sandboxImage,
          base,
          ...args,
        ],
        { cwd: this.root, timeoutMs },
      );
    }
    return exec(base, args, { cwd: this.root, timeoutMs, env: { PATH } });
  }

  /* ----------------------------------------------------------------- git */

  private git(args: string[], timeoutMs = 120_000): Promise<ExecResult> {
    return exec(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=List Agentic Platform',
        '-c',
        'user.email=agents@listsoftware.local',
        ...args,
      ],
      {
        cwd: this.root,
        timeoutMs,
      },
    );
  }

  private async gitOk(args: string[], timeoutMs?: number): Promise<string> {
    const r = await this.git(args, timeoutMs);
    if (r.exitCode !== 0)
      throw new WorkspaceError(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 1000)}`);
    return r.stdout.trim();
  }

  async diff(staged = false): Promise<string> {
    await this.gitOk(['add', '-A', '--intent-to-add']);
    return this.gitOk(['diff', ...(staged ? ['--cached'] : []), '--stat', '--patch', '--no-color']);
  }

  async changedFiles(base: string): Promise<{ status: string; path: string }[]> {
    const out = await this.gitOk(['diff', '--name-status', `${base}...HEAD`]);
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [status, ...rest] = l.split('\t');
        return { status: status!, path: rest.join('\t') };
      });
  }

  /** Commit everything. Returns the commit sha, or null when nothing changed. */
  async commitAll(message: string): Promise<string | null> {
    await this.gitOk(['add', '-A']);
    const status = await this.gitOk(['status', '--porcelain']);
    if (!status) return null;
    await this.gitOk(['commit', '-m', message]);
    return this.gitOk(['rev-parse', 'HEAD']);
  }

  headSha(): Promise<string> {
    return this.gitOk(['rev-parse', 'HEAD']);
  }

  /* -------------------------------------------------------- static setup */

  /**
   * Clone (or refresh) a repository into `dir` and check out `branch`.
   * A token is passed through an HTTP header for this command only; it is
   * never written to the repository config.
   */
  static async checkout(options: {
    dir: string;
    url: string;
    baseBranch: string;
    workBranch?: string;
    token?: string | null;
    policy: WorkspacePolicy;
  }): Promise<Workspace> {
    const { dir, url, baseBranch, workBranch, token } = options;
    const auth = token
      ? [
          '-c',
          `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
        ]
      : [];
    await fs.mkdir(path.dirname(dir), { recursive: true });
    const exists = await fs
      .access(path.join(dir, '.git'))
      .then(() => true)
      .catch(() => false);
    const run = async (args: string[], cwd: string) => {
      const r = await exec('git', [...auth, ...args], { cwd, timeoutMs: 600_000 });
      if (r.exitCode !== 0)
        throw new WorkspaceError(
          `git ${args[0]} failed: ${redact(r.stderr || r.stdout, token)
            .trim()
            .slice(0, 1500)}`,
        );
      return r.stdout.trim();
    };
    if (!exists) {
      await run(['clone', '--no-tags', '--branch', baseBranch, url, dir], path.dirname(dir));
    } else {
      await run(['fetch', 'origin', baseBranch], dir);
    }
    if (workBranch) {
      const hasLocal =
        (await exec('git', ['rev-parse', '--verify', workBranch], { cwd: dir })).exitCode === 0;
      if (hasLocal) await run(['checkout', workBranch], dir);
      else await run(['checkout', '-b', workBranch, `origin/${baseBranch}`], dir);
    } else {
      await run(['checkout', '--detach', `origin/${baseBranch}`], dir);
    }
    return new Workspace(dir, options.policy);
  }

  /** Push the work branch. Only the platform calls this, after the release gate. */
  async push(branch: string, token?: string | null): Promise<void> {
    const auth = token
      ? [
          '-c',
          `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
        ]
      : [];
    const r = await exec('git', [...auth, 'push', '--set-upstream', 'origin', branch], {
      cwd: this.root,
      timeoutMs: 600_000,
    });
    if (r.exitCode !== 0)
      throw new WorkspaceError(
        `git push failed: ${redact(r.stderr || r.stdout, token)
          .trim()
          .slice(0, 1500)}`,
      );
  }
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function redact(text: string, secret?: string | null): string {
  return secret ? text.split(secret).join('***') : text;
}
