---
name: code-review
description: Review a change set for correctness, completeness against the plan, maintainability, performance and deployability, with findings ranked by severity.
---

# Code review

Read the full diff (`git_diff`) and the plan. Review what changed and what should have changed but did not.

## Checklist
1. **Plan coverage**: every change in the plan is implemented; nothing unplanned slipped in (unrelated reformatting, debug code, commented-out blocks).
2. **Correctness**: logic matches the acceptance criteria; NULL handling for existing rows; boundary lengths; error messages.
3. **Consistency**: form item length ≤ column length; report data item matches query column; spec and body agree; triggers updated where columns are listed explicitly.
4. **Transactions and concurrency**: no commits inside routines called by forms; no lost updates; locks on large tables considered.
5. **Performance**: new queries use indexed predicates; no row-by-row loops over large sets where a set-based statement works.
6. **Deployability**: migration + rollback present and ordered; scripts re-runnable; compiled objects valid.
7. **Tests**: tests exist for each change and passed; reproduction test for defects.
8. **Readability**: follows the file's existing conventions; names say what things are.

## Severity
- `blocker`: wrong behaviour, data loss risk, won't compile or deploy, security issue.
- `major`: likely defect or missing piece that must be fixed before release.
- `minor`: should improve, not release-blocking.
- `info`: observation.

`approved` is true only when there are no blockers or majors. Every finding cites the file (and line when possible) and a concrete recommendation.
