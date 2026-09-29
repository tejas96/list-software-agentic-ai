import { spawn } from 'node:child_process';

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  input?: string;
  /** Output beyond this many characters per stream is dropped (with a marker). */
  maxOutput?: number;
}

/** Run a program without a shell. Arguments are passed as-is, so there is no injection surface. */
export function exec(command: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const max = options.maxOutput ?? 200_000;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...minimalEnv(), ...options.env } as NodeJS.ProcessEnv,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (buf: string, chunk: Buffer) => (buf.length >= max ? buf : buf + chunk.toString('utf8').slice(0, max - buf.length));
    child.stdout.on('data', (c: Buffer) => (stdout = append(stdout, c)));
    child.stderr.on('data', (c: Buffer) => (stderr = append(stderr, c)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 120_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}${err.message}`, timedOut, durationMs: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdout.length >= max) stdout += '\n…[output truncated]';
      if (stderr.length >= max) stderr += '\n…[output truncated]';
      resolve({ exitCode: code, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/** Commands never inherit the worker's secrets: only a minimal environment is passed. */
function minimalEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'C.UTF-8',
    TMPDIR: process.env.TMPDIR,
    GIT_TERMINAL_PROMPT: '0',
  };
}
