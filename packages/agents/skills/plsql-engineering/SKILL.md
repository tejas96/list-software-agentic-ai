---
name: plsql-engineering
description: Write and change PL/SQL packages, procedures, functions and triggers to production standard: specs vs bodies, exceptions, bind variables, invalidation impact and style consistency.
---

# PL/SQL engineering

## Package changes
- **Spec vs body**: changing a spec invalidates every dependant (forms, reports, other packages) and forces recompilation. Prefer adding a new overload or new routine to the spec over changing an existing signature. Body-only changes are cheap.
- Keep new public routines in the spec in the same order and style as existing ones. Private helpers go in the body only.
- Default new parameters (`p_address IN VARCHAR2 DEFAULT NULL`) so existing callers keep working.

## Code standards
- Anchor types: `customer.address%TYPE`, `customer%ROWTYPE`. Never hard-code lengths that exist in the table.
- Bind variables always. Dynamic SQL only with `USING` binds; never concatenate user input; `DBMS_ASSERT` for identifiers.
- Explicit column lists in `INSERT` and `SELECT` (no `SELECT *` in new code).
- Exceptions: handle only what you can handle. Use `RAISE_APPLICATION_ERROR(-20xxx, 'clear message')` with the project's existing error-number range; never `WHEN OTHERS THEN NULL`. Re-raise after logging.
- No `COMMIT`/`ROLLBACK` inside routines called by forms unless the existing design does so; the form owns the transaction.
- Validation routines return or raise; they do not write data.
- Match the file's existing conventions (naming prefixes like `p_`, `l_`, `g_`, case, indentation). Consistency beats personal preference.

## Triggers
- Database triggers on tables fire for every writer (forms, batch, interfaces). Adding logic there affects all of them; prefer package calls from the application unless the rule truly must hold for every writer.
- Audit triggers that list columns must include new columns.

## Compile and verify
- After changes, compile against the sandbox (`oracle_run_sql` with the full `CREATE OR REPLACE`) and check `USER_ERRORS` / `ALL_ERRORS` for the object. Recompile invalid dependants (`ALTER PACKAGE x COMPILE BODY`).
- Keep scripts re-runnable (`CREATE OR REPLACE`).
