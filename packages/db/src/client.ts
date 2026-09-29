import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.js';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A transaction handle. Every helper that writes accepts `Db | Tx`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDb(url: string, options: Omit<PoolConfig, 'connectionString'> = {}): DbHandle {
  const pool = new Pool({
    connectionString: url,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...options,
  });
  pool.on('error', (err) => {
    // An idle client lost its connection; the pool replaces it on next use.
    console.error('[db] idle client error', err.message);
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
