import { count } from 'drizzle-orm';
import { appendActivity } from './activity.js';
import { createDb } from './client.js';
import { loadRootEnv } from './env.js';
import { hashPassword } from './passwords.js';
import { users } from './schema.js';

/**
 * Creates the first administrator when the database has no users.
 * Idempotent: does nothing once any user exists. No sample data is created.
 */
async function main(): Promise<void> {
  loadRootEnv();
  const url = process.env.DATABASE_URL;
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? 'Administrator';
  if (!url || !email || !password) {
    throw new Error('DATABASE_URL, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set');
  }
  if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
  const { db, close } = createDb(url, { max: 1 });
  try {
    const [row] = await db.select({ n: count() }).from(users);
    if ((row?.n ?? 0) > 0) {
      console.warn('Users already exist; nothing to seed.');
      return;
    }
    await db.transaction(async (tx) => {
      const [admin] = await tx
        .insert(users)
        .values({ email: email.toLowerCase(), name, passwordHash: await hashPassword(password), isAdmin: true })
        .returning({ id: users.id });
      await appendActivity(tx, {
        projectId: null,
        actorType: 'system',
        type: 'user.created',
        summary: `Created the first administrator ${email.toLowerCase()}`,
        data: { userId: admin!.id, isAdmin: true },
      });
    });
    console.warn(`Created administrator ${email.toLowerCase()}. Change the password after first sign-in.`);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
