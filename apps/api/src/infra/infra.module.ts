import { Global, Module } from '@nestjs/common';
import { LlmGateway } from '@lsa/agents';
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
    {
      provide: LlmGateway,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        new LlmGateway({
          apiKey: c.ANTHROPIC_API_KEY || null,
          model: c.LLM_MODEL,
          refusalFallback: c.LLM_REFUSAL_FALLBACK !== 'false',
        }),
    },
    Database,
    TemporalService,
    AccessService,
    SessionTokens,
  ],
  exports: [APP_CONFIG, Database, SecretBox, LlmGateway, TemporalService, AccessService, SessionTokens],
})
export class InfraModule {}
