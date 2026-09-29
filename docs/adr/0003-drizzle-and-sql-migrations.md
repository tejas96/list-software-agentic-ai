# 0003 · Drizzle ORM with reviewed SQL migrations

## Decision

Tables are defined in `packages/db/src/schema.ts` with Drizzle. Migrations are SQL files in `packages/db/migrations`, generated with `drizzle-kit` and then reviewed and extended by hand (extensions, triggers, partial unique indexes).

## Why

- Drizzle is typed SQL without a runtime query engine, so queries stay predictable and explainable.
- Some guarantees belong in the database, not the application: append-only audit triggers, "one pending gate per run", "one active run per ticket". Plain SQL migrations can express them.

## Consequences

- Every schema change is a new migration file; existing migrations are never edited.
- `pnpm db:migrate` (or the `migrate` container) applies them; the API and worker never migrate on start-up.
