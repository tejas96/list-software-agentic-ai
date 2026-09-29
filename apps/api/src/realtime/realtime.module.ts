import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { EVENTS_CHANNEL, eventRooms, type RealtimeEvent } from '@lsa/contracts';
import { runs, tickets } from '@lsa/db';
import { AccessService } from '../common/access.service.js';
import { SESSION_COOKIE, SessionTokens, type SessionUser } from '../common/auth.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Database } from '../infra/database.js';

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Browsers connect with their session cookie and subscribe to rooms they can
 * see: `project:<id>`, `ticket:<id>`, `run:<id>`. Their own `user:<id>` room
 * (notifications) is joined automatically; `workspace` is for administrators.
 */
@WebSocketGateway({
  path: '/socket.io',
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger('Realtime');
  @WebSocketServer() server!: Server;

  constructor(
    private readonly tokens: SessionTokens,
    private readonly database: Database,
    private readonly access: AccessService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
    const user = await this.tokens.resolve(this.database, token);
    if (!user) {
      socket.emit('error', { code: 'unauthenticated' });
      socket.disconnect(true);
      return;
    }
    (socket.data as { user: SessionUser }).user = user;
    await socket.join(`user:${user.id}`);
    if (user.isAdmin) await socket.join('workspace');
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { room?: string },
  ): Promise<{ ok: boolean }> {
    const user = (socket.data as { user?: SessionUser }).user;
    const room = String(body?.room ?? '');
    if (!user) return { ok: false };
    const projectId = await this.projectOfRoom(room);
    if (!projectId) return { ok: false };
    const role = await this.access.roleIn(user, projectId);
    if (!role) return { ok: false };
    await socket.join(room);
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { room?: string },
  ): Promise<{ ok: boolean }> {
    await socket.leave(String(body?.room ?? ''));
    return { ok: true };
  }

  private async projectOfRoom(room: string): Promise<string | null> {
    const [kind, id] = room.split(':');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const db = this.database.db;
    if (kind === 'project') return id;
    if (kind === 'ticket')
      return (
        (await db.select({ p: tickets.projectId }).from(tickets).where(eq(tickets.id, id)))[0]?.p ?? null
      );
    if (kind === 'run')
      return (await db.select({ p: runs.projectId }).from(runs).where(eq(runs.id, id)))[0]?.p ?? null;
    return null;
  }

  broadcast(event: RealtimeEvent): void {
    if (!this.server) return;
    this.server.to(eventRooms(event)).emit('event', event);
  }

  get log(): Logger {
    return this.logger;
  }
}

/** Relays Postgres NOTIFY events (from the API and the worker) to Socket.IO rooms. Reconnects on failure. */
@Injectable()
export class EventRelay implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('EventRelay');
  private client: pg.Client | null = null;
  private stopped = false;
  private retryMs = 1000;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.config.DATABASE_URL });
    client.on('notification', (msg) => {
      if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
      try {
        this.gateway.broadcast(JSON.parse(msg.payload) as RealtimeEvent);
      } catch (err) {
        this.logger.warn(`Bad event payload: ${(err as Error).message}`);
      }
    });
    client.on('error', (err) => {
      this.logger.warn(`Listener connection error: ${err.message}`);
      void this.reconnect();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${EVENTS_CHANNEL}`);
      this.client = client;
      this.retryMs = 1000;
      this.logger.log(`Listening on ${EVENTS_CHANNEL}`);
    } catch (err) {
      this.logger.warn(`Cannot listen for events: ${(err as Error).message}`);
      await client.end().catch(() => undefined);
      void this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;
    const old = this.client;
    this.client = null;
    await old?.end().catch(() => undefined);
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
    setTimeout(() => void this.connect(), wait).unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    await this.client?.end().catch(() => undefined);
  }
}

@Module({ providers: [RealtimeGateway, EventRelay] })
export class RealtimeModule {}
