import 'reflect-metadata';
import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config.js';

export async function createApp(options: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      options.logger === false
        ? false
        : new ConsoleLogger({ json: process.env.NODE_ENV === 'production', prefix: 'lsa-api' }),
    bufferLogs: true,
  });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && incoming.length <= 100 ? incoming : randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });
  app.useBodyParser('json', { limit: '2mb' });
  app.enableCors({ origin: config.WEB_ORIGIN.split(','), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('List Software Agentic Platform API')
      .setVersion('1.0')
      .addCookieAuth('lsa_session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, doc);
  return app;
}

async function main(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.API_PORT);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
