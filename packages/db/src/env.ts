import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load the repository-root .env when running scripts from a package folder. */
export function loadRootEnv(): void {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(candidate)) {
      config({ path: candidate, quiet: true });
      return;
    }
  }
}
