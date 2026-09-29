import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendActivity, canonicalJson, verifyActivityChain } from './activity.js';
import { createDb, type DbHandle } from './client.js';
import { loadRootEnv } from './env.js';
import { SecretBox } from './secrets.js';

describe('SecretBox', () => {
  const box = new SecretBox('a'.repeat(64));

  it('round-trips a secret and never stores plain text', () => {
    const env = box.encrypt('s3cret-token');
    expect(env).not.toContain('s3cret-token');
    expect(box.decrypt(env)).toBe('s3cret-token');
  });

  it('rejects tampered ciphertext', () => {
    const env = box.encrypt('value');
    const parts = env.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });

  it('rejects a malformed master key', () => {
    expect(() => new SecretBox('short')).toThrow();
  });
});

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }),
    );
  });
});

loadRootEnv();
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('audit trail (database)', () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDb(url!, { max: 2 });
  });
  afterAll(async () => {
    await handle.close();
  });

  it('appends entries that verify as an unbroken chain', async () => {
    await handle.db.transaction(async (tx) => {
      await appendActivity(tx, {
        projectId: null,
        actorType: 'system',
        type: 'user.updated',
        summary: 'Test entry',
        data: { z: 1, a: 'x' },
      });
    });
    const result = await verifyActivityChain(handle.db);
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThan(0);
  });

  it('rejects updates and deletes', async () => {
    const causeOf = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'no error';
      } catch (err) {
        const e = err as { cause?: { message?: string }; message?: string };
        return e.cause?.message ?? e.message ?? '';
      }
    };
    expect(await causeOf(handle.db.execute(sql`update activities set summary = 'changed'`))).toMatch(/append-only/);
    expect(await causeOf(handle.db.execute(sql`delete from activities`))).toMatch(/append-only/);
  });
});
