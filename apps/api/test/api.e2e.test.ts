/**
 * End-to-end tests against the compiled API (dist), a real Postgres and the configured
 * Temporal address. Vitest's transpiler does not emit decorator metadata, so the test boots
 * the same build that runs in production. Skipped when DATABASE_URL is not set.
 *
 * Everything the test creates is namespaced by a random project key and archived or
 * disabled at the end, so it can run against a development database.
 */
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRootEnv } from '@lsa/db';

loadRootEnv();
const enabled =
  !!process.env.DATABASE_URL && !!process.env.SEED_ADMIN_EMAIL && !!process.env.SEED_ADMIN_PASSWORD;

type Agent = ReturnType<typeof request.agent>;
const CLIENT = { 'x-lsa-client': 'test' };

describe.skipIf(!enabled)('API end to end', () => {
  let app: INestApplication;
  let admin: Agent;
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  const key = `T${suffix.replace(/[^A-Z0-9]/g, '')}`.slice(0, 8);
  const viewerEmail = `viewer-${suffix.toLowerCase()}@test.local`;
  const viewerPassword = `pw-${randomBytes(8).toString('hex')}`;
  let projectId = '';
  let viewerId = '';

  beforeAll(async () => {
    const { createApp } = (await import('../dist/main.js')) as typeof import('../src/main.js');
    app = await createApp({ logger: false });
    await app.init();
    admin = request.agent(app.getHttpServer());
    const res = await admin
      .post('/api/v1/auth/login')
      .set(CLIENT)
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
    expect(res.status).toBe(200);
  }, 30_000);

  afterAll(async () => {
    if (projectId) await admin.patch(`/api/v1/projects/${projectId}`).set(CLIENT).send({ archived: true });
    if (viewerId) await admin.patch(`/api/v1/users/${viewerId}`).set(CLIENT).send({ status: 'disabled' });
    await app?.close();
  });

  it('serves health without a session and rejects anonymous calls', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/api/v1/health')).status).toBe(200);
    const anon = await request(server).get('/api/v1/projects');
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBeTruthy();
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const server = app.getHttpServer();
    const wrongPassword = await request(server)
      .post('/api/v1/auth/login')
      .set(CLIENT)
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: 'definitely-not-it' });
    const unknownUser = await request(server)
      .post('/api/v1/auth/login')
      .set(CLIENT)
      .send({ email: `nobody-${suffix}@test.local`, password: 'definitely-not-it' });
    expect(wrongPassword.status).toBeGreaterThanOrEqual(400);
    expect(unknownUser.status).toBe(wrongPassword.status);
    expect(unknownUser.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('refuses state-changing requests without the client header (CSRF guard)', async () => {
    const res = await admin
      .post('/api/v1/projects')
      .send({ key: `${key}X`.slice(0, 10), name: 'Should not exist' });
    expect(res.status).toBe(403);
  });

  it('creates a project and validates its settings', async () => {
    const res = await admin
      .post('/api/v1/projects')
      .set(CLIENT)
      .send({ key, name: `E2E ${suffix}`, techStack: ['PL/SQL'] });
    expect(res.status).toBe(201);
    projectId = res.body.id;
    expect(res.body.key).toBe(key);

    const dup = await admin.post('/api/v1/projects').set(CLIENT).send({ key, name: 'Duplicate' });
    expect(dup.status).toBeGreaterThanOrEqual(400);

    // Keep the test independent of the triage workflow.
    const off = await admin
      .patch(`/api/v1/projects/${projectId}`)
      .set(CLIENT)
      .send({ settings: { autoTriage: false } });
    expect(off.status).toBe(200);
    expect(off.body.settings.autoTriage).toBe(false);

    const shell = await admin
      .patch(`/api/v1/projects/${projectId}`)
      .set(CLIENT)
      .send({ settings: { allowedCommands: ['git; rm -rf /'] } });
    expect(shell.status).toBe(422);
    const foreign = await admin
      .patch(`/api/v1/projects/${projectId}`)
      .set(CLIENT)
      .send({ settings: { workSourceId: '00000000-0000-4000-8000-000000000000' } });
    expect(foreign.status).toBe(422);
  });

  it('numbers tickets per project and enforces board rules', async () => {
    const a = await admin
      .post('/api/v1/tickets')
      .set(CLIENT)
      .send({ projectId, title: 'First requirement', type: 'feature' });
    const b = await admin
      .post('/api/v1/tickets')
      .set(CLIENT)
      .send({ projectId, title: 'Second requirement', type: 'bug' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.key).toBe(`${key}-1`);
    expect(b.body.key).toBe(`${key}-2`);

    const moved = await admin
      .post(`/api/v1/tickets/${a.body.key}/move`)
      .set(CLIENT)
      .send({ status: 'ready', version: a.body.version });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('ready');

    const stale = await admin
      .post(`/api/v1/tickets/${a.body.key}/move`)
      .set(CLIENT)
      .send({ status: 'backlog', version: a.body.version });
    expect(stale.status).toBe(409);

    const agentColumn = await admin
      .post(`/api/v1/tickets/${b.body.key}/move`)
      .set(CLIENT)
      .send({ status: 'building', version: b.body.version });
    expect(agentColumn.status).toBe(422);

    const timeline = await admin.get(`/api/v1/tickets/${a.body.key}/timeline`);
    const types = (timeline.body as { type: string }[]).map((x) => x.type);
    expect(types).toContain('ticket.created');
    expect(types).toContain('ticket.moved');
  });

  it('applies project roles: a viewer can read but not create', async () => {
    const created = await admin
      .post('/api/v1/users')
      .set(CLIENT)
      .send({ email: viewerEmail, name: 'E2E Viewer', password: viewerPassword });
    expect(created.status).toBe(201);
    viewerId = created.body.id;
    expect(
      (
        await admin
          .post(`/api/v1/projects/${projectId}/members`)
          .set(CLIENT)
          .send({ userId: viewerId, role: 'viewer' })
      ).status,
    ).toBeLessThan(300);

    const viewer = request.agent(app.getHttpServer());
    expect(
      (
        await viewer
          .post('/api/v1/auth/login')
          .set(CLIENT)
          .send({ email: viewerEmail, password: viewerPassword })
      ).status,
    ).toBe(200);
    const list = await viewer.get(`/api/v1/tickets?projectId=${projectId}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    const denied = await viewer.post('/api/v1/tickets').set(CLIENT).send({ projectId, title: 'Not allowed' });
    expect(denied.status).toBe(403);
    expect((await viewer.get('/api/v1/users')).status).toBe(403);

    // Disabling a user ends their session immediately.
    await admin.patch(`/api/v1/users/${viewerId}`).set(CLIENT).send({ status: 'disabled' });
    expect((await viewer.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('logs requirements from other systems with an intake token, idempotently', async () => {
    const server = app.getHttpServer();
    const issued = await admin.post(`/api/v1/projects/${projectId}/intake-token`).set(CLIENT);
    expect(issued.status).toBe(200);
    const body = { text: 'Customers need to update their address online', externalRef: `SR-${suffix}` };

    expect(
      (await request(server).post(`/api/v1/intake/${key}`).set('authorization', 'Bearer wrong').send(body))
        .status,
    ).toBe(401);
    const first = await request(server)
      .post(`/api/v1/intake/${key}`)
      .set('authorization', `Bearer ${issued.body.token}`)
      .send(body);
    expect(first.status).toBe(201);
    const again = await request(server)
      .post(`/api/v1/intake/${key}`)
      .set('authorization', `Bearer ${issued.body.token}`)
      .send(body);
    expect(again.body.key).toBe(first.body.key);

    const rotated = await admin.post(`/api/v1/projects/${projectId}/intake-token`).set(CLIENT);
    expect(rotated.body.token).not.toBe(issued.body.token);
    expect(
      (
        await request(server)
          .post(`/api/v1/intake/${key}`)
          .set('authorization', `Bearer ${issued.body.token}`)
          .send(body)
      ).status,
    ).toBe(401);
  });

  it('keeps the audit chain intact and pageable', async () => {
    const verify = await admin.get('/api/v1/audit/verify');
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    const page = await admin.get(`/api/v1/audit?projectId=${projectId}`);
    expect(page.status).toBe(200);
    const seqs = (page.body as { seq: number; hash: string }[]).map((x) => x.seq);
    expect(seqs.length).toBeGreaterThan(3);
    expect([...seqs].sort((x, y) => y - x)).toEqual(seqs);
    const older = await admin.get(`/api/v1/audit?projectId=${projectId}&before=${seqs[1]}`);
    expect((older.body as { seq: number }[]).every((x) => x.seq < seqs[1]!)).toBe(true);
  });
});
