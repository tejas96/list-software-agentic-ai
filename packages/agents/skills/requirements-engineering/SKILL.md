---
name: requirements-engineering
description: Turn a raw change request into precise requirements and testable acceptance criteria; detect ambiguity, hidden scope and missing rules.
---

# Requirements engineering

## Goal
A developer, a tester and an auditor must read the same spec and reach the same understanding. Every requirement is testable; every acceptance criterion maps to at least one test.

## Method
1. **Restate the need** in one sentence from the user's side: who needs what, and why.
2. **Classify** the ticket: `feature` (new behaviour), `bug` (behaviour differs from what was intended), `hotfix` (bug hurting production now), `analysis` (answer a question, no change), `task` (technical work with no behaviour change).
3. **Search the knowledge graph** for the screens, reports and tables the request names. Use their real names (e.g. `CUSTOMER_ACCOUNT`, `PKG_CUSTOMER`) in the spec. Never invent component names; if you cannot find one, say so in `openQuestions`.
4. **Write requirements** as short, atomic statements: `R1 The account-opening form captures the customer's address.` One behaviour per line. Use "must" only for mandatory behaviour.
5. **Write acceptance criteria** in Given/When/Then:
   - Given a precondition that a tester can set up.
   - When one user or system action.
   - Then an observable, checkable outcome (screen value, stored column, report field, error message text).
   Cover the happy path, validation failures, boundaries (empty, maximum length, special characters), edit/update paths, and downstream outputs (reports, interfaces).
6. **Non-functional needs** that matter in banking: audit trail, data masking, performance on large tables, backward compatibility with existing records (what happens to rows created before the change?).
7. **Assumptions**: write down every decision you made that the request did not state. Keep them few and reasonable.
8. **Open questions**: only questions whose answer changes the implementation. Do not ask about things you can find in the code.
9. **Out of scope**: list what a reader might expect but this change will not do.

## Checks before submitting
- Every criterion is testable without interpretation.
- Existing data is considered (migration default, nullable, backfill).
- Downstream consumers (reports, extracts, APIs) are named.
- Priority: `critical` only for production-down or regulatory deadlines; `high` for blocked users; `medium` default; `low` for cosmetic.
