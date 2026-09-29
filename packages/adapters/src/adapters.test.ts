import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec } from './process.js';
import { normaliseStatement, OracleAdapter, OracleUnavailableError } from './oracle.js';
import { Workspace, WorkspaceError } from './workspace.js';

const policy = {
  allowedCommands: ['ls', 'git', 'node'],
  sandboxMode: 'local' as const,
  sandboxImage: 'node:22',
};

describe('Workspace', () => {
  let root: string;
  let ws: Workspace;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lsa-ws-'));
    await mkdir(path.join(root, 'forms'));
    await writeFile(
      path.join(root, 'forms', 'CUSTOMER.pkb'),
      'create or replace package body pkg_customer as\nend;\n',
    );
    await symlink('/etc', path.join(root, 'escape'));
    ws = new Workspace(root, policy);
  });
  afterAll(async () => rm(root, { recursive: true, force: true }));

  it('refuses paths outside the root, including through symlinks', async () => {
    await expect(ws.resolve('../outside')).rejects.toBeInstanceOf(WorkspaceError);
    await expect(ws.resolve('/etc/passwd')).resolves.toBe(path.join(root, 'etc/passwd'));
    await expect(ws.readFile('escape/hostname')).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('lists, reads with line numbers and searches', async () => {
    const { files } = await ws.listFiles('.', '**/*.pkb');
    expect(files).toEqual(['forms/CUSTOMER.pkb']);
    const r = await ws.readFile('forms/CUSTOMER.pkb');
    expect(r.content).toContain('    1  create or replace package body');
    const s = await ws.searchFiles('package body');
    expect(s.matches[0]).toMatchObject({ path: 'forms/CUSTOMER.pkb', line: 1 });
  });

  it('requires a read before an edit and rejects stale edits', async () => {
    const fresh = new Workspace(root, policy);
    await expect(fresh.editFile('forms/CUSTOMER.pkb', 'end;', 'end pkg_customer;')).rejects.toThrow(/Read/);
    await fresh.readFile('forms/CUSTOMER.pkb');
    await writeFile(path.join(root, 'forms', 'CUSTOMER.pkb'), 'changed elsewhere\nend;\n');
    await expect(fresh.editFile('forms/CUSTOMER.pkb', 'end;', 'x')).rejects.toThrow(/changed since/);
    await fresh.readFile('forms/CUSTOMER.pkb');
    await fresh.editFile('forms/CUSTOMER.pkb', 'end;', 'end pkg_customer;');
    expect((await fresh.readText('forms/CUSTOMER.pkb')).trim().endsWith('end pkg_customer;')).toBe(true);
  });

  it('rejects ambiguous edits', async () => {
    await ws.writeFile('dup.txt', 'a\na\n');
    await ws.readFile('dup.txt');
    await expect(ws.editFile('dup.txt', 'a', 'b')).rejects.toThrow(/more than once/);
  });

  it('only runs allow-listed programs, without a shell', async () => {
    await expect(ws.run('rm', ['-rf', '/'])).rejects.toThrow(/not an allowed command/);
    await expect(ws.run('/bin/ls', [])).rejects.toThrow(/without a path/);
    await expect(ws.run('git', ['push'])).rejects.toThrow(/handled by the platform/);
    const r = await ws.run('ls', ['forms; rm -rf /']);
    expect(r.exitCode).not.toBe(0); // the argument is a literal file name, not a command
  });
});

describe('Workspace git checkout', () => {
  let base: string;
  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'lsa-git-'));
    const origin = path.join(base, 'origin');
    await mkdir(origin);
    const g = (args: string[], cwd = origin) =>
      exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
    await g(['init', '-b', 'main']);
    await writeFile(path.join(origin, 'README.md'), 'hello\n');
    await g(['add', '.']);
    await g(['commit', '-m', 'init']);
  });
  afterAll(async () => rm(base, { recursive: true, force: true }));

  it('clones, branches, commits and reports changed files', async () => {
    const ws = await Workspace.checkout({
      dir: path.join(base, 'work'),
      url: `file://${path.join(base, 'origin')}`,
      baseBranch: 'main',
      workBranch: 'lsa/BNK-1',
      policy,
    });
    await ws.writeFile('new.sql', 'select 1 from dual;\n');
    const sha = await ws.commitAll('BNK-1: add query');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await ws.commitAll('nothing')).toBeNull();
    expect(await ws.changedFiles('origin/main')).toEqual([{ status: 'A', path: 'new.sql' }]);
  });
});

describe('Oracle adapter', () => {
  it('explains missing tooling instead of failing obscurely', async () => {
    const ora = new OracleAdapter({}, null);
    expect(ora.capabilities).toEqual({ forms: false, reports: false, sandboxDb: false });
    await expect(ora.runSql('select 1 from dual')).rejects.toBeInstanceOf(OracleUnavailableError);
  });

  it('normalises statements for the driver', () => {
    expect(normaliseStatement('select * from dual;')).toBe('select * from dual');
    expect(normaliseStatement('begin null; end;\n/')).toBe('begin null; end;');
    expect(normaliseStatement('CREATE OR REPLACE PACKAGE p AS END p;')).toBe(
      'CREATE OR REPLACE PACKAGE p AS END p;',
    );
  });
});
