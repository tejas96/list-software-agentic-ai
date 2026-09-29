---
name: test-design
description: Derive a complete, traceable test plan from acceptance criteria and the change plan: positive, negative, boundary, regression and reproduction tests, automated where possible.
---

# Test design

## Traceability
- Every acceptance criterion has at least one test (`criterionId`).
- Every planned change has at least one test (the architect's `testsByChange`).
- Every `verify` component in the impact map has a regression test.

## Techniques
- **Equivalence classes and boundaries**: empty, minimum, maximum length, maximum + 1, special characters (apostrophes, accented letters, `&`, `%`), leading/trailing spaces.
- **State**: create vs edit vs query of existing records (records created before the change have NULL in new columns — the form and report must handle it).
- **Negative paths**: validation errors show the right message and do not save.
- **Downstream**: reports and extracts show the new data correctly, including NULL.
- **Reproduction (defects)**: first write a test that fails on the current code for the reported reason. It must pass after the fix and stays as a regression test.

## Automation choice
- Database logic (packages, triggers, constraints) → automated PL/SQL tests (utPLSQL if the project uses it, otherwise an anonymous-block test script that raises on failure).
- Report output → query-level check of the report's data source SQL against known sandbox data.
- Form UI behaviour that needs a human screen → `manual` with exact steps; keep these few.
- Name tests after behaviour: `test_create_account_saves_address`.

## Test case content
`steps` are concrete and executable by someone new; `expected` is observable (value in column X, message text Y, row count Z).
