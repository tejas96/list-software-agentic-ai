import { Global, Module } from '@nestjs/common';
import { createDb, SecretBox } from '@lsa/db';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config.js';
import { AccessService } from '../common/access.service.js';
import { SessionTokens } from '../common/auth.js';
import { Database, DB_HANDLE } from './database.js';
import { TemporalService } from './temporal.service.js';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: DB_HANDLE, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createDb(c.DATABASE_URL) },
    { provide: SecretBox, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new SecretBox(c.MASTER_KEY) },
    Database,
    TemporalService,
    AccessService,
    SessionTokens,
  ],
  exports: [APP_CONFIG, Database, SecretBox, TemporalService, AccessService, SessionTokens],
})
export class InfraModule {}
