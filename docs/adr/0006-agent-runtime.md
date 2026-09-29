# 0006 · Own agent runtime on the Anthropic SDK

## Decision

Agents call Claude through the official Anthropic TypeScript SDK (streaming, adaptive thinking, prompt caching, context editing for long tool loops). The runtime is ours, in `packages/agents`:

- **11 agents, 17 tasks, 3 workflows** are data in `packages/contracts` (`agents.ts`, `workflows.ts`).
- **Skills** are Markdown packs (`packages/agents/skills/*/SKILL.md`). An agent sees the list and loads a pack with `load_skill` only when it needs it.
- **Tools** are grouped (knowledge, workspace read/write, commands, Oracle, git), and each agent gets only its groups.
- Every task ends with `submit_result`, validated against the zod schema of the artifact it must produce; invalid output goes back to the model with the errors. `report_blocker` stops the run for a person.
- Token usage and cost are recorded per step and enforced against the project's per-run budget.

## Why

- The platform's value is the controls around the model: approval gates, budgets, sandboxing, audit and evidence. Those need to be explicit code, not a framework's defaults.
- Skills on demand keep prompts small and let domain experts improve agents by editing Markdown.

## Consequences

- The default model is set with `LLM_MODEL`. Changing models is configuration, but prompts and skills should be re-checked when it changes.
- Without an API key the platform still works; runs escalate with a clear message.
