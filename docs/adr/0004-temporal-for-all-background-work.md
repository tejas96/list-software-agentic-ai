# 0004 · Temporal for all background work

## Decision

Every long-running or retryable job runs as a Temporal workflow: the SDLC run (`sdlcRunWorkflow`), triage, source sync and agent replies to comments. Approvals and run controls are signals; the run's live state is a query. There is no other job queue.

Activities that touch a run's checked-out repository run on a **host-specific task queue** (`<TEMPORAL_TASK_QUEUE>@<WORKER_ID>`): the first activity claims a host and the rest of the run stays there.

## Why

- Runs last hours or days while waiting for people. Temporal persists that state durably, retries failed steps with backoff, and survives worker restarts without bespoke bookkeeping.
- Keeping a run on one host avoids copying the repository between machines.

## Consequences

- Workflow code must be deterministic; all I/O lives in activities.
- Gates are re-read from the database every five minutes, so a lost signal cannot stall a run.
- A worker host must keep a stable `WORKER_ID` and its workspaces volume. If a host is lost, its runs wait until it returns, or can be cancelled and retried.
