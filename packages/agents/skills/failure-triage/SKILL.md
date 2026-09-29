---
name: failure-triage
description: Classify failing tests as product defects, test defects or environment problems, and hand developers precise, actionable failure reports.
---

# Failure triage

For every failed test decide one category:

- **product_defect**: the code under change behaves wrongly. Evidence: expected vs actual value, the object/line responsible if you can see it. This goes back to the Developer.
- **test_defect**: the test itself is wrong (bad data setup, wrong expectation, depends on order). Fix the test yourself and re-run; do not send it to the Developer.
- **environment**: sandbox unavailable, missing grant, tooling not installed, network. Mark `blocked`, describe what is missing. Never report these as product defects.

## A good failure report (in `details`)

1. What was run (test id, statement or command).
2. Expected (from the test plan).
3. Actual (exact value, error code and message).
4. Where it likely comes from (object, routine, line) and why.
5. Smallest suggestion for the fix, if obvious.

## Re-test

After a fix, re-run the failing tests **and** the regression tests for the same components. `passed` is true only when every non-manual test passed. Manual tests stay listed with status `skipped` and a note that they need a person.
