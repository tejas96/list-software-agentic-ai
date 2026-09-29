# 0005 · Append-only, hash-chained audit trail

## Decision

Every action by a person, agent or the system is written to `activities`. Database triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on that table. Each entry stores the SHA-256 of its canonical content plus the previous entry's hash, and entries are appended under an advisory lock so the chain has one order.

## Why

Banking clients need to show who asked for a change, who approved it, what the agents did and what was tested. A chain lets anyone check that nothing was removed or edited afterwards (**Audit log → Verify integrity**, `GET /audit/verify`).

## Consequences

- Appends are serialised; this is fine at the platform's write volume.
- Ticket timelines, the evidence pack and the audit log all read the same table, so they cannot disagree.
