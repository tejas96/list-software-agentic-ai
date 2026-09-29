# 0001 · pnpm + Turborepo monorepo, ESM everywhere, TypeScript 5.9

## Decision

One repository with `apps/{api,worker,web}` and `packages/*`, managed by pnpm workspaces and Turborepo. Every package is an ES module (`"type": "module"`, `NodeNext` resolution). TypeScript is pinned to 5.9.

## Why

- API, worker and web share one set of contracts (zod schemas, lifecycle rules, permissions). A single repo makes a contract change and all its consumers one reviewable commit.
- NestJS 12 ships as ESM only, so the whole backend must be ESM.
- TypeScript 7 (the native compiler) does not yet emit `emitDecoratorMetadata`, which NestJS dependency injection relies on. 5.9 is the newest compiler that does.

## Consequences

- Imports inside packages use `.js` suffixes.
- Turbo runs builds in strict environment mode: variables a build reads (for example `API_INTERNAL_URL` for the web proxy) must be listed under `tasks.build.env` in `turbo.json`.
- ESLint runs `consistent-type-imports` with decorator metadata enabled, so constructor-injected classes stay value imports.
