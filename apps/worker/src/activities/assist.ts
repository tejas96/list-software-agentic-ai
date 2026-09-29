import { ApplicationFailure } from '@temporalio/activity';
import { and, desc, eq, ne, notInArray, sql } from 'drizzle-orm';
import { answerQuestion, LlmError, triageTicket } from '@lsa/agents';
import { AGENTS, type AgentKey } from '@lsa/contracts';
import { appendActivity, artifacts, llmUsage, projects, publish, ticketComments, tickets } from '@lsa/db';
import { knowledgeObjectByName, notifyUsers, searchKnowledge, ticketWatchers } from '@lsa/domain';
import type { Deps } from '../deps.js';

export function assistActivities(deps: Deps) {
  const { db, llm } = deps;

  const recordUsage = (projectId: string, agentKey: AgentKey | null, purpose: string, u: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number }) =>
    db.insert(llmUsage).values({ projectId, agentKey, purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, costUsd: u.costUsd });

  const mapLlmError = (err: unknown): never => {
    if (err instanceof LlmError) {
      if (err.retryable) throw ApplicationFailure.retryable(err.message, `Llm_${err.code}`);
      throw ApplicationFailure.nonRetryable(err.message, `Llm_${err.code}`);
    }
    throw err;
  };

  return {
    /**
     * Classify a new ticket, draft acceptance criteria, suggest labels and flag
     * likely duplicates. Fields the requester set on the board are kept.
     */
    async triage(ticketId: string): Promise<void> {
      const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
      if (!t || t.triageState !== 'pending') return;
      if (!llm.available) {
        await db.transaction(async (tx) => {
          await tx.update(tickets).set({ triageState: 'skipped', triageNote: 'Triage skipped: no LLM provider is configured.' }).where(eq(tickets.id, ticketId));
          await publish(tx, { type: 'ticket.changed', projectId: t.projectId, ticketId });
        });
        return;
      }
      const [p] = await db.select().from(projects).where(eq(projects.id, t.projectId));
      const text = `${t.title}\n${t.description}`.slice(0, 2000);
      const candidates = await db
        .select({ id: tickets.id, key: tickets.key, title: tickets.title, status: tickets.status })
        .from(tickets)
        .where(
          and(
            eq(tickets.projectId, t.projectId),
            ne(tickets.id, ticketId),
            notInArray(tickets.status, ['cancelled']),
            sql`${tickets.searchVector} @@ websearch_to_tsquery('english', ${text.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 12).join(' or ')})`,
          ),
        )
        .orderBy(desc(sql`ts_rank(${tickets.searchVector}, websearch_to_tsquery('english', ${text.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 12).join(' or ')}))`))
        .limit(8);
      const components = (await searchKnowledge(db, t.projectId, t.title, { limit: 12 })).map((h) => ({ name: h.name, kind: h.kind }));
      let out;
      try {
        out = await triageTicket(llm, {
          project: { key: p!.key, name: p!.name, techStack: p!.techStack },
          ticket: { key: t.key, title: t.title, description: t.description, type: t.type, priority: t.priority, hasCriteria: t.acceptanceCriteria.length > 0 },
          candidates,
          components,
        });
      } catch (err) {
        if (err instanceof LlmError && !err.retryable) {
          await db.update(tickets).set({ triageState: 'failed', triageNote: `Triage failed: ${err.message}` }).where(eq(tickets.id, ticketId));
          await publish(db, { type: 'ticket.changed', projectId: t.projectId, ticketId });
          return;
        }
        return mapLlmError(err);
      }
      await recordUsage(t.projectId, 'requirement_analyst', 'triage', out.usage);
      const r = out.result;
      const derived = t.source !== 'board'; // Home and external intake titles/types were derived from free text
      const dup = r.duplicateOfKey ? candidates.find((c) => c.key === r.duplicateOfKey) : undefined;
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
        if (!current) return;
        await tx
          .update(tickets)
          .set({
            ...(derived && current.version === t.version && { title: r.title, type: r.type, priority: r.priority }),
            ...(current.acceptanceCriteria.length === 0 && r.acceptanceCriteria.length > 0 && {
              acceptanceCriteria: r.acceptanceCriteria.map((text, i) => ({ id: `AC${i + 1}`, text })),
            }),
            labels: [...new Set([...current.labels, ...r.labels.map((l) => l.toLowerCase().replace(/\s+/g, '-'))])].slice(0, 20),
            duplicateOfId: dup?.id ?? null,
            triageState: 'done',
            triageNote: r.summary,
            version: sql`${tickets.version} + 1`,
          })
          .where(eq(tickets.id, ticketId));
        await appendActivity(tx, {
          projectId: t.projectId,
          ticketId,
          actorType: 'agent',
          agentKey: 'requirement_analyst',
          type: 'ticket.triaged',
          summary: `Triaged as ${r.type}, ${r.priority} priority${current.acceptanceCriteria.length === 0 && r.acceptanceCriteria.length ? `, drafted ${r.acceptanceCriteria.length} acceptance criteria` : ''}`,
          data: { type: r.type, priority: r.priority, labels: r.labels, applied: derived },
        });
        if (dup) {
          await appendActivity(tx, {
            projectId: t.projectId,
            ticketId,
            actorType: 'agent',
            agentKey: 'requirement_analyst',
            type: 'ticket.duplicate_flagged',
            summary: `Possible duplicate of ${dup.key}: ${r.duplicateReason ?? ''}`,
            data: { duplicateOf: dup.key },
          });
          await notifyUsers(tx, ticketWatchers(current), {
            type: 'ticket.duplicate',
            title: `${t.key} may duplicate ${dup.key}`,
            body: r.duplicateReason ?? '',
            link: `/tickets/${t.key}`,
          });
        }
        await publish(tx, { type: 'ticket.changed', projectId: t.projectId, ticketId });
      });
    },

    /** Answer a question asked of an agent in a ticket comment (e.g. "@QA which tests cover this?"). */
    async replyToComment(commentId: string, agentKey: AgentKey): Promise<void> {
      const [c] = await db.select().from(ticketComments).where(eq(ticketComments.id, commentId));
      if (!c) return;
      const [t] = await db.select().from(tickets).where(eq(tickets.id, c.ticketId));
      const post = async (body: string) =>
        db.transaction(async (tx) => {
          const [reply] = await tx.insert(ticketComments).values({ ticketId: t!.id, authorType: 'agent', agentKey, body }).returning({ id: ticketComments.id });
          await appendActivity(tx, {
            projectId: t!.projectId,
            ticketId: t!.id,
            actorType: 'agent',
            agentKey,
            type: 'comment.added',
            summary: `${AGENTS[agentKey].name} replied`,
            data: { commentId: reply!.id, inReplyTo: commentId },
          });
          await publish(tx, { type: 'comment.added', projectId: t!.projectId, ticketId: t!.id, commentId: reply!.id });
          if (c.authorId) {
            await notifyUsers(tx, [c.authorId], { type: 'comment.reply', title: `${AGENTS[agentKey].name} replied on ${t!.key}`, body: body.slice(0, 200), link: `/tickets/${t!.key}` });
          }
        });
      if (!llm.available) {
        await post('I can’t answer yet: no LLM provider is configured for this workspace. An administrator needs to set ANTHROPIC_API_KEY.');
        return;
      }
      const question = c.body.replace(/@[\w\-/]+/g, '').trim();
      const hits = await searchKnowledge(db, t!.projectId, question.slice(0, 300), { limit: 6 });
      const sources = [];
      for (const h of hits.slice(0, 5)) {
        const o = await knowledgeObjectByName(db, t!.projectId, h.name);
        if (o) sources.push({ name: o.name, kind: o.kind, path: o.path, text: `${o.summary ?? ''}\n${o.content}` });
      }
      const arts = t!.activeRunId
        ? await db.select().from(artifacts).where(eq(artifacts.runId, t!.activeRunId)).orderBy(desc(artifacts.createdAt)).limit(6)
        : await db.select().from(artifacts).where(eq(artifacts.ticketId, t!.id)).orderBy(desc(artifacts.createdAt)).limit(6);
      try {
        const res = await answerQuestion(llm, {
          agent: agentKey,
          question,
          ticket: { key: t!.key, title: t!.title, description: t!.description, status: t!.status },
          artifacts: arts.map((a) => ({ kind: a.kind, title: a.title, content: a.content })),
          sources,
        });
        await recordUsage(t!.projectId, agentKey, 'comment_reply', res.usage);
        await post(res.answer || 'I could not find an answer in the recorded evidence.');
      } catch (err) {
        if (err instanceof LlmError && !err.retryable) {
          await post(`I couldn’t answer: ${err.message}`);
          return;
        }
        mapLlmError(err);
      }
    },
  };
}
