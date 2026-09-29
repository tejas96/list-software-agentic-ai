import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Db, DbHandle } from '@lsa/db';

export const DB_HANDLE = Symbol('DB_HANDLE');

/** Services inject `Database` and query through `.db`. */
@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly logger = new Logger('Database');
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  get db(): Db {
    return this.handle.db;
  }

  get pool() {
    return this.handle.pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
    this.logger.log('Connection pool closed');
  }
}
