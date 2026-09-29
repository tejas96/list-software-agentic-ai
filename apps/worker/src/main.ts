import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { hostActivities, sharedActivities } from './activities/index.js';
import { loadConfig } from './config.js';
import { createDeps } from './deps.js';

/**
 * One process runs two Temporal workers:
 * - the shared queue: workflows and activities any worker can run;
 * - a host queue: activities that use a run's checked-out repository,
 *   so every step of a run works in the same workspace.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const deps = createDeps(config);
  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });

  const shared = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows/index.js', import.meta.url)),
    activities: sharedActivities(deps),
    maxConcurrentActivityTaskExecutions: config.MAX_CONCURRENT_ACTIVITIES,
  });
  const host = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.hostQueue,
    activities: hostActivities(deps),
    maxConcurrentActivityTaskExecutions: Math.max(1, Math.floor(config.MAX_CONCURRENT_ACTIVITIES / 2)),
  });

  console.warn(
    `[worker] ${config.WORKER_ID} ready — queues ${config.TEMPORAL_TASK_QUEUE} and ${config.hostQueue}; LLM ${deps.llm.available ? `configured (${config.LLM_MODEL})` : 'NOT configured'}; sandbox ${config.SANDBOX_MODE}`,
  );

  const stop = () => {
    shared.shutdown();
    host.shutdown();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await Promise.all([shared.run(), host.run()]);
  } finally {
    await connection.close();
    await deps.close();
  }
}

main().catch((err: unknown) => {
  console.error('[worker] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
