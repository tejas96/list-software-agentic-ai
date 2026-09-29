import { createHash } from 'node:crypto';
import { asc, desc, sql } from 'drizzle-orm';
import {
  EVENTS_CHANNEL,
  type ActivityType,
  type ActorType,
  type AgentKey,
  type RealtimeEvent,
} from '@lsa/contracts';
import type { DbOrTx } from './client.js';
import { activities } from './schema.js';

export const GENESIS_HASH = '0'.repeat(64);
const CHAIN_LOCK_KEY = 7_311_001; // arbitrary constant for pg_advisory_xact_lock

export interface ActivityInput {
  projectId: string | null;
  ticketId?: string | null;
  runId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  agentKey?: AgentKey | null;
  type: ActivityType;
  summary: string;
  data?: Record<string, unknown>;
}

/** Canonical JSON: object keys sorted, so the hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function activityHash(
  prevHash: string,
  row: {
    id: string;
    projectId: string | null;
    ticketId: string | null;
    runId: string | null;
    actorType: string;
    actorId: string | null;
    agentKey: string | null;
    type: string;
    summary: string;
    data: Record<string, unknown>;
    createdAt: string;
  },
): string {
  return createHash('sha256').update(prevHash).update('\n').update(canonicalJson(row)).digest('hex');
}

/**
 * Append one entry to the audit trail and publish it to realtime listeners.
 * Must run inside a transaction: the advisory lock serialises the hash chain,
 * and the NOTIFY is delivered only if the transaction commits.
 */
export async function appendActivity(tx: DbOrTx, input: ActivityInput): Promise<{ id: string; seq: number }> {
  await tx.execute(sql`select pg_advisory_xact_lock(${CHAIN_LOCK_KEY})`);
  const [last] = await tx
    .select({ hash: activities.hash })
    .from(activities)
    .orderBy(desc(activities.seq))
    .limit(1);
  const prevHash = last?.hash ?? GENESIS_HASH;
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const row = {
    id,
    projectId: input.projectId,
    ticketId: input.ticketId ?? null,
    runId: input.runId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    agentKey: input.agentKey ?? null,
    type: input.type,
    summary: input.summary,
    data: input.data ?? {},
    createdAt: createdAt.toISOString(),
  };
  const hash = activityHash(prevHash, row);
  const [inserted] = await tx
    .insert(activities)
    .values({ ...row, createdAt, prevHash, hash })
    .returning({ seq: activities.seq });
  if (input.projectId) {
    await publish(tx, {
      type: 'activity.added',
      projectId: input.projectId,
      ticketId: input.ticketId ?? null,
      runId: input.runId ?? null,
      activityId: id,
    });
  }
  return { id, seq: inserted!.seq };
}

/** Send a realtime event. Delivered to listeners when the surrounding transaction commits. */
export async function publish(tx: DbOrTx, event: RealtimeEvent): Promise<void> {
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

/** Recompute every hash in order. Reads in pages to keep memory flat on long trails. */
export async function verifyActivityChain(db: DbOrTx, pageSize = 2000): Promise<ChainVerification> {
  let prevHash = GENESIS_HASH;
  let afterSeq = 0;
  let checked = 0;
  for (;;) {
    const page = await db
      .select()
      .from(activities)
      .where(sql`${activities.seq} > ${afterSeq}`)
      .orderBy(asc(activities.seq))
      .limit(pageSize);
    if (page.length === 0) break;
    for (const r of page) {
      if (r.prevHash !== prevHash) {
        return { ok: false, checked, brokenAtSeq: r.seq, reason: 'Previous-hash link does not match' };
      }
      const expected = activityHash(prevHash, {
        id: r.id,
        projectId: r.projectId,
        ticketId: r.ticketId,
        runId: r.runId,
        actorType: r.actorType,
        actorId: r.actorId,
        agentKey: r.agentKey,
        type: r.type,
        summary: r.summary,
        data: r.data,
        createdAt: r.createdAt.toISOString(),
      });
      if (expected !== r.hash) {
        return { ok: false, checked, brokenAtSeq: r.seq, reason: 'Entry content does not match its hash' };
      }
      prevHash = r.hash;
      afterSeq = r.seq;
      checked++;
    }
  }
  return { ok: true, checked, brokenAtSeq: null, reason: null };
}
