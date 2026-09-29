---
name: impact-analysis
description: Trace every component a change touches in a legacy Oracle system (forms, reports, packages, tables, triggers, views) using the knowledge graph and the code, with evidence for each finding.
---

# Impact analysis

Nothing is changed blind. The impact map is the contract the rest of the team works from, so every entry needs evidence.

## Procedure

1. **Anchor**: find the objects the requirement names (`knowledge_search`). Prefer exact object names. Try synonyms (e.g. "address" → `ADDRESS`, `ADDR`, `ADDRESS_LINE1`).
2. **Walk dependencies** with `knowledge_dependencies` in both directions, depth 2:
   - Forms → blocks → data-source tables; triggers → packages they call.
   - Packages → tables they read/write; other packages they call.
   - Tables → every form, report, view, trigger and package that reads or writes them.
   - Reports → queries → tables; formula program units → packages.
3. **Confirm in code** with `read_file` / `search_files`: open the actual trigger or procedure. Graph edges are leads, code is evidence.
4. **Look for implicit coupling** the graph can miss:
   - `SELECT *` and `%ROWTYPE` (adding a column changes record shape; code using positional INSERT without column list breaks).
   - Dynamic SQL (`EXECUTE IMMEDIATE`, `DBMS_SQL`), string-built table names.
   - Database triggers on the table (audit triggers must include the new column).
   - Views over the table (need the column added to expose it).
   - Interfaces/extract files with fixed-width layouts.
   - LOVs and record groups with hard-coded queries.
5. **Classify each component**: `modify` (must change), `add` (new), `verify` (should not change but must be regression-tested), `none` (checked, unaffected — include only if a reader would expect it).
6. **Risks**: data volume (ALTER on large tables), locking, invalidation cascade (changing a package spec invalidates dependants), NOT NULL on existing rows, performance of new queries.

## Evidence format

For each component: `finding` = one sentence with the concrete fact and where you saw it, e.g. "POST-INSERT trigger on block CUSTOMER inserts into CUSTOMER_AUDIT with an explicit column list (CUSTOMER_ACCOUNT_fmb.xml line 212) — needs the new column".

## Root cause (defects)

For bugs: reproduce the reasoning from symptom to code. State the exact line or condition that is wrong, why it produces the symptom, and which other paths share it.
