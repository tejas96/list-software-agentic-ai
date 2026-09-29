---
name: evidence-pack
description: Assemble traceability from requirement to code to test to approval so an auditor can verify a change without asking anyone.
---

# Evidence pack

An auditor should be able to answer, from the pack alone:
1. Why was the change made? (ticket, requirement spec)
2. What was affected and how was that determined? (impact map with evidence)
3. What was planned and who approved it? (change plan, gate 1 decision)
4. What exactly changed? (file manifest, commit, diff summary)
5. How was it proven? (test plan ↔ acceptance criteria, test results including failures and fixes)
6. Was it reviewed for quality and security? (review and security reports)
7. Who approved the release, and how is it rolled back? (gate 2 decision, rollback plan)

## Rules
- Reference artifacts by their recorded titles and versions; do not re-describe them differently.
- Include failures and how they were resolved. Hiding a failed attempt breaks trust.
- Use the ticket key everywhere (branch, commit messages, notes) so records join up.
