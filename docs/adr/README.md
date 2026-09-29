# Architecture decision records

Each record states a decision, why it was made, and what it costs. Status is _Accepted_ unless noted.

| #                                                | Decision                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [0001](0001-monorepo-and-toolchain.md)           | pnpm + Turborepo monorepo, ESM everywhere, TypeScript 5.9                        |
| [0002](0002-postgres-only.md)                    | Postgres 17 is the only datastore                                                |
| [0003](0003-drizzle-and-sql-migrations.md)       | Drizzle ORM with reviewed SQL migrations                                         |
| [0004](0004-temporal-for-all-background-work.md) | Temporal for all background work, with host-affine task queues                   |
| [0005](0005-append-only-audit-chain.md)          | Append-only, hash-chained audit trail                                            |
| [0006](0006-agent-runtime.md)                    | Own agent runtime on the Anthropic SDK: skills, tool groups, validated artifacts |
| [0007](0007-knowledge-graph.md)                  | Deterministic knowledge graph in Postgres; Graphify as an optional importer      |
| [0008](0008-security-model.md)                   | Cookie sessions, CSRF header, per-project roles, encrypted credentials           |
| [0009](0009-single-origin-web.md)                | The web server proxies the API and realtime socket (one origin)                  |
| [0010](0010-deferred-scope.md)                   | Deliberately deferred: SSO, multi-tenancy, Oracle tool installation              |
