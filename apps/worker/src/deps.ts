import { LlmGateway, SkillRegistry } from '@lsa/agents';
import { createDb, SecretBox, type DbHandle } from '@lsa/db';
import type { WorkerConfig } from './config.js';

/** Long-lived dependencies shared by all activities in one worker process. */
export interface Deps {
  config: WorkerConfig;
  db: DbHandle['db'];
  close: () => Promise<void>;
  llm: LlmGateway;
  skills: SkillRegistry;
  box: SecretBox;
}

export function createDeps(config: WorkerConfig): Deps {
  const handle = createDb(config.DATABASE_URL, { max: config.MAX_CONCURRENT_ACTIVITIES + 4 });
  return {
    config,
    db: handle.db,
    close: handle.close,
    llm: new LlmGateway({ apiKey: config.ANTHROPIC_API_KEY || null, model: config.LLM_MODEL, refusalFallback: config.LLM_REFUSAL_FALLBACK }),
    skills: new SkillRegistry(),
    box: new SecretBox(config.MASTER_KEY),
  };
}
