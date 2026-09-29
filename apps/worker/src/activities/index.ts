import type { Deps } from '../deps.js';
import { agentStepActivities } from './agent-step.js';
import { assistActivities } from './assist.js';
import { releaseActivities } from './release.js';
import { runActivities } from './runs.js';
import { syncActivities } from './sync.js';

/** Activities on the shared queue: any worker can run them. */
export function sharedActivities(deps: Deps) {
  return { ...runActivities(deps), ...assistActivities(deps), ...syncActivities(deps) };
}

/** Activities that need the run's checked-out repository: they run on the worker that owns it. */
export function hostActivities(deps: Deps) {
  return { ...agentStepActivities(deps), ...releaseActivities(deps) };
}

export type SharedActivities = ReturnType<typeof sharedActivities>;
export type HostActivities = ReturnType<typeof hostActivities>;
