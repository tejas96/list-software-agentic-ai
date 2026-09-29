---
name: release-packaging
description: Package an approved change set for the customer's CI/CD: deployment order, manifest, rollback plan and hand-off notes. Never deploys to production directly.
---

# Release packaging

The Release agent prepares; the customer's pipeline deploys. Production is never touched from the platform.

## Deployment order (typical Oracle change)
1. Database DDL (tables, columns, indexes, constraints).
2. Package specs, then package bodies, then triggers and views.
3. Recompile invalid objects in the schema; verify none remain invalid.
4. Data scripts (backfills), if any.
5. Forms (`.fmx` generated from `.fmb` on the target), menus, libraries.
6. Reports (`.rdf`/`.rep`).
7. Smoke checks.

## Manifest
List every file in the change set with its kind (`ddl`, `plsql_spec`, `plsql_body`, `trigger`, `form`, `report`, `rollback`, `test`, `doc`), taken from `git_diff`, not from memory.

## Rollback plan
Reverse order: previous forms/reports restored from the release before, package versions restored, then DDL rollback scripts. State data impact of each rollback step (e.g. dropping a column loses data entered after release).

## Hand-off
- The branch name and that it is ready for the customer's pipeline.
- Preconditions (grants, maintenance window for large-table DDL).
- Post-deployment checks derived from the test plan (the smoke subset).
