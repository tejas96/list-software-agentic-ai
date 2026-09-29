import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  MASTER_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEY must be 64 hex characters'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
  TEMPORAL_TASK_QUEUE: z.string().default('lsa-sdlc'),
  WORKER_ID: z.string().default(os.hostname()),
  WORKSPACES_DIR: z.string().default('./.data/workspaces'),
  SANDBOX_MODE: z.enum(['local', 'docker']).default('local'),
  SANDBOX_IMAGE: z.string().default('node:22-bookworm'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-opus-5-5'),
  LLM_REFUSAL_FALLBACK: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  EMBEDDINGS_PROVIDER: z.enum(['none', 'voyage']).default('none'),
  VOYAGE_API_KEY: z.string().optional(),
  ORACLE_FORMS_BIN_DIR: z.string().optional(),
  ORACLE_REPORTS_BIN_DIR: z.string().optional(),
  /** Optional command to build a Graphify graph for a source, e.g. "graphify extract {dir}". Run without a shell. */
  GRAPHIFY_CMD: z.string().optional(),
  MAX_CONCURRENT_ACTIVITIES: z.coerce.number().int().min(1).default(8),
});

export type WorkerConfig = z.infer<typeof Env> & { workspacesRoot: string; hostQueue: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid worker configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const c = parsed.data;
  return {
    ...c,
    workspacesRoot: path.resolve(c.WORKSPACES_DIR),
    // Activities that use a run's checked-out repository run on the worker that holds it.
    hostQueue: `${c.TEMPORAL_TASK_QUEUE}@${c.WORKER_ID}`,
  };
}
