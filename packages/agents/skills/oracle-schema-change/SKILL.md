---
name: oracle-schema-change
description: Design and write safe Oracle DDL/DML migrations with matching rollback scripts, handling existing data, locking, large tables, grants and synonyms.
---

# Oracle schema changes

Every change ships as a pair: `NNN_description.sql` and `NNN_description_rollback.sql`, placed where the repository keeps migrations (look for an existing folder and numbering scheme first; follow it exactly).

## Adding a column
- New columns on existing tables are **nullable** unless a default is agreed. `ALTER TABLE t ADD (col VARCHAR2(400))` is metadata-only and fast.
- `ADD ... DEFAULT x NOT NULL` is fast on modern Oracle (metadata default) but changes behaviour for existing rows: confirm the business rule first.
- Size to the business rule, in characters for text: `VARCHAR2(400 CHAR)` if the database uses byte semantics by default and multibyte data is possible (check existing columns' style).
- Add a comment: `COMMENT ON COLUMN t.col IS '...'`.
- Rollback: `ALTER TABLE t DROP COLUMN col` — note it destroys data entered after release; say so in the rollback header.

## Other changes
- Indexes on large tables: `CREATE INDEX ... ONLINE` where the edition allows; mention expected build time.
- Renames and type changes are breaking: prefer add-new, backfill, switch, drop-old across releases.
- Constraints: add as `ENABLE NOVALIDATE` first on large tables, validate separately.
- Grants and synonyms: if other schemas use the table through synonyms, check whether they need grants on new objects.
- Views that must expose the column need `CREATE OR REPLACE VIEW` with the explicit column.

## Script rules
- Idempotent where practical: guard with a data-dictionary check in a PL/SQL block, or document that the script runs once.
- No `DROP` of data in forward scripts unless the plan explicitly approves it.
- Separate DDL from DML; batch large updates with commits in chunks only in dedicated data-migration scripts.
- Test the pair on the sandbox: forward, verify, rollback, verify, forward again. Set `rollbackVerified` true only if you did this.
