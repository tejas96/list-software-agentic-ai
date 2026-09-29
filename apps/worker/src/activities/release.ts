import { ApplicationFailure } from '@temporalio/activity';
import { eq } from 'drizzle-orm';
import { appendActivity, artifacts, runs, tickets } from '@lsa/db';
import type { Deps } from '../deps.js';
import { latestArtifact } from './runs.js';
import { prepareRunEnvironment } from './workspace.js';

/**
 * After the release gate: push the work branch to the customer's repository
 * and, for GitHub, open a pull request. Their CI/CD takes it from there.
 * The platform never deploys to production itself.
 */
export function releaseActivities(deps: Deps) {
  const { db } = deps;
  return {
    async publishBranch(runId: string): Promise<{ pushed: boolean; branch: string | null; pullRequestUrl: string | null; note: string }> {
      const env = await prepareRunEnvironment(db, deps.box, deps.config, runId, true);
      const [run] = await db.select().from(runs).where(eq(runs.id, runId));
      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, run!.ticketId));
      if (!env.workspace || !env.branch) {
        return { pushed: false, branch: null, pullRequestUrl: null, note: 'No repository is connected, so there is no branch to publish.' };
      }
      try {
        await env.workspace.push(env.branch, env.gitToken);
      } catch (err) {
        throw ApplicationFailure.nonRetryable(`Could not push ${env.branch}: ${(err as Error).message}`, 'PushFailed');
      }
      let pullRequestUrl: string | null = null;
      let note = `Pushed ${env.branch}.`;
      const gh = env.sourceUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
      if (gh && env.gitToken) {
        const notes = await latestArtifact(db, runId, 'release_notes');
        const body = [
          `Change for **${ticket!.key}**: ${ticket!.title}`,
          '',
          (notes?.content as { markdown?: string } | undefined)?.markdown ?? '',
          '',
          '_Prepared by the List Software agentic platform. Plan and release were approved at the platform gates; see the evidence pack for the full trail._',
        ].join('\n');
        const res = await fetch(`https://api.github.com/repos/${gh[1]}/${gh[2]}/pulls`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.gitToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `${ticket!.key}: ${ticket!.title}`, head: env.branch, base: env.settings.baseBranch, body }),
        });
        if (res.ok) {
          pullRequestUrl = ((await res.json()) as { html_url?: string }).html_url ?? null;
          note = `Pushed ${env.branch} and opened a pull request.`;
        } else if (res.status === 422) {
          note = `Pushed ${env.branch}. A pull request for this branch already exists.`;
        } else {
          note = `Pushed ${env.branch}, but the pull request could not be opened (GitHub returned ${res.status}). Open it manually.`;
        }
      }
      await db.transaction(async (tx) => {
        const pkg = await latestArtifact(tx, runId, 'release_package');
        if (pkg) {
          await tx
            .update(artifacts)
            .set({ content: { ...(pkg.content as object), pushed: true, pullRequestUrl } })
            .where(eq(artifacts.id, pkg.id));
        }
        await appendActivity(tx, {
          projectId: run!.projectId,
          ticketId: run!.ticketId,
          runId,
          actorType: 'agent',
          agentKey: 'release',
          type: 'artifact.created',
          summary: note,
          data: { branch: env.branch, pullRequestUrl },
        });
      });
      return { pushed: true, branch: env.branch, pullRequestUrl, note };
    },
  };
}
