# 0007 · Deterministic knowledge graph; Graphify as an optional importer

## Decision

Source sync parses the repository and, optionally, the Oracle data dictionary with our own deterministic parsers: PL/SQL (packages, procedures, functions, triggers, table and call references), Oracle Forms XML (`frmf2xml` exports: blocks, items, triggers, program units) and Reports XML (`rwconverter` exports: queries, data items). References are resolved to edges by name when the graph is saved. Text is chunked for full-text and optional vector search (Voyage embeddings).

Graphify output is supported as an importer (`GRAPHIFY_CMD`), not as the main parser.

## Why

- Impact analysis on banking code must be reproducible and explainable: "this form calls that package which writes this table" has to come from the code, not from a model's guess.
- Graphify does not understand PL/SQL, Forms or Reports, which are the core of these systems. It adds value for general code, so it can contribute edges alongside ours.

## Consequences

- New languages need a parser (or the Graphify importer) before agents can trace them.
- Full-text search works with no external services; embeddings improve recall when configured.
