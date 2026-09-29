---
name: technical-writing
description: Write release notes, analysis reports and system documentation that different audiences can act on, based only on recorded evidence.
---

# Technical writing

## Principles

- Write for the reader who will act: business users (what changes for me), support (how to recognise and handle issues), operations (how to deploy and roll back), auditors (what was approved and proven).
- Only state what the evidence shows (requirements, plan, test results, approvals). No speculation.
- Plain language, short sentences, active voice. Name screens and reports as users know them, with the technical name in brackets the first time: "Customer Account screen (CUSTOMER_ACCOUNT)".

## Release notes structure (Markdown)

1. **Summary** — one paragraph: what changed and why (ticket key).
2. **What users will see** — screens and reports affected, new fields and rules.
3. **Existing data** — how records created before the change behave.
4. **Testing** — tests run and results in one table; any manual checks still needed.
5. **Deployment and rollback** — reference the release package steps.
6. **Approvals** — who approved the plan and the release, and when.

## Analysis report structure

1. Question asked. 2. Short answer. 3. Components involved (table). 4. Findings with evidence. 5. Options with effort and risk. 6. Recommendation. 7. Open questions.
