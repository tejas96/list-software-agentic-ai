/** A node in the code graph, before it is stored. Identity is (kind, name). */
export interface ObjectRecord {
  kind: string;
  /** Upper-case for Oracle objects (Oracle names are case-insensitive). */
  name: string;
  path: string | null;
  language: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  /** Text split into chunks for search. */
  chunks: ChunkRecord[];
  contentHash: string;
}

export interface ChunkRecord {
  ordinal: number;
  content: string;
  startLine: number | null;
  endLine: number | null;
}

export type EdgeKind = 'contains' | 'calls' | 'reads' | 'writes' | 'references' | 'imports';

/**
 * A reference from one object to another by name. It is resolved to an edge
 * when stored, against every object in the project (so a form in Git can link
 * to a table found through the Oracle metadata source).
 */
export interface RefRecord {
  from: { kind: string; name: string };
  toName: string;
  /** Kinds the target may have, most specific first. */
  toKinds: string[];
  kind: EdgeKind;
}

/** Raw references found in code, resolved against known objects at graph-build time. */
export interface References {
  reads: string[];
  writes: string[];
  calls: string[];
}

export interface ParsedUnit {
  kind: string;
  name: string;
  schema: string | null;
  startLine: number;
  endLine: number;
  text: string;
  members: string[];
  refs: References;
  extra: Record<string, unknown>;
}

export interface GraphResult {
  objects: ObjectRecord[];
  refs: RefRecord[];
  warnings: string[];
}
