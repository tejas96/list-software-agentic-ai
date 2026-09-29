# 0002 · Postgres 17 is the only datastore

## Decision

Postgres 17 holds platform data, the audit trail, the knowledge graph (objects, edges, text chunks with full-text, trigram and `pgvector` indexes) and Temporal's persistence. There is no Redis, Elasticsearch or separate graph or vector database.

## Why

- One system to back up, secure, monitor and restore. For an internal platform with a small operations team this matters more than peak performance.
- The workloads fit comfortably: dependency traversal is a recursive CTE, hybrid search combines `tsvector`, `pg_trgm` and HNSW vector search in one query, and realtime fan-out uses `LISTEN/NOTIFY`.

## Consequences

- A `pg_dump` of the platform database plus Temporal's databases is a complete backup.
- If the knowledge graph ever outgrows Postgres, the `knowledge` and `domain` packages are the only places that query it.
