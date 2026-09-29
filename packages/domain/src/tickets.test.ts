import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, loadRootEnv, projects, tickets, type DbHandle } from '@lsa/db';
import type { Actor } from './actor.js';
import { createTicket, setTicketStatus, type NewTicket } from './tickets.js';

loadRootEnv();
const url = process.env.DATABASE_URL;
const system: Actor = { type: 'system' };

describe.skipIf(!url)('tickets (database)', () => {
  let handle: DbHandle;
  let projectId: string;
  const key = `D${randomBytes(3).toString('hex').toUpperCase()}`;
  const input = (title: string): NewTicket => ({
    projectId,
    title,
    description: '',
    type: 'feature',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    source: 'board',
    status: 'backlog',
    reporterId: null,
  });

  beforeAll(async () => {
    handle = createDb(url!, { max: 12 });
    const [p] = await handle.db
      .insert(projects)
      .values({ key, name: `Domain test ${key}` })
      .returning({ id: projects.id });
    projectId = p!.id;
  });
  afterAll(async () => {
    await handle.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, projectId));
    await handle.close();
  });

  it('gives concurrent tickets unique, gap-free numbers', async () => {
    const rows = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        handle.db.transaction((tx) => createTicket(tx, input(`Concurrent ${i}`), system)),
      ),
    );
    const numbers = rows.map((r) => Number(r.key.split('-')[1])).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(rows.map((r) => r.rank)).size).toBe(10);
  });

  it('places a new ticket at the top of its column', async () => {
    const t = await handle.db.transaction((tx) => createTicket(tx, input('Newest'), system));
    const column = await handle.db
      .select({ id: tickets.id, rank: tickets.rank })
      .from(tickets)
      .where(eq(tickets.projectId, projectId));
    expect(Math.min(...column.map((c) => c.rank))).toBe(t.rank);
  });

  it('records status changes and closes finished tickets', async () => {
    const t = await handle.db.transaction((tx) => createTicket(tx, input('To finish'), system));
    const done = await handle.db.transaction((tx) =>
      setTicketStatus(tx, t.id, 'done', system, { reason: 'Released' }),
    );
    expect(done.status).toBe('done');
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row?.closedAt).toBeInstanceOf(Date);
  });

  it('refuses new tickets in an archived project', async () => {
    const [p] = await handle.db
      .insert(projects)
      .values({ key: `${key}A`.slice(0, 10), name: 'Archived', archivedAt: new Date() })
      .returning({ id: projects.id });
    await expect(
      handle.db.transaction((tx) => createTicket(tx, { ...input('Nope'), projectId: p!.id }, system)),
    ).rejects.toThrow(/archived/);
  });
});
