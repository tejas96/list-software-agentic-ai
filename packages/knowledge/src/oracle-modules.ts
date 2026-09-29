import { extractReferences } from './plsql.js';
import type { References } from './types.js';
import { attr, deepText, findAll, parseXml, type XmlNode } from './xml.js';

export interface FormTrigger {
  name: string;
  scope: string;
  text: string;
  line: number;
}

export interface FormBlock {
  name: string;
  dataSource: string | null;
  dmlTarget: string | null;
  items: { name: string; column: string | null; type: string | null; dataType: string | null; maxLength: string | null }[];
}

export interface ParsedForm {
  name: string;
  blocks: FormBlock[];
  triggers: FormTrigger[];
  programUnits: { name: string; type: string | null; text: string; line: number }[];
  recordGroups: { name: string; query: string | null }[];
  lovs: { name: string; recordGroup: string | null }[];
  libraries: string[];
  refs: References;
}

const upper = (s: string | undefined | null) => (s ? s.toUpperCase() : null);

/** Parse an Oracle Forms module exported with frmf2xml (e.g. CUSTOMER_ACCOUNT_fmb.xml). */
export function parseFormXml(xml: string, fallbackName: string): ParsedForm | null {
  const doc = parseXml(xml);
  const form = findAll(doc, 'FormModule')[0];
  if (!form) return null;
  const name = upper(attr(form, 'Name')) ?? fallbackName.toUpperCase();

  const blocks: FormBlock[] = findAll(form, 'Block').map((b) => ({
    name: upper(attr(b, 'Name'))!,
    dataSource: upper(attr(b, 'QueryDataSourceName')),
    dmlTarget: upper(attr(b, 'DMLDataTargetName')) ?? upper(attr(b, 'QueryDataSourceName')),
    items: findAll(b, 'Item').map((it) => ({
      name: upper(attr(it, 'Name'))!,
      column: upper(attr(it, 'ColumnName')),
      type: attr(it, 'ItemType') ?? null,
      dataType: attr(it, 'DataType') ?? null,
      maxLength: attr(it, 'MaximumLength') ?? null,
    })),
  }));

  const triggers: FormTrigger[] = [];
  const collect = (node: XmlNode, scope: string) => {
    for (const c of node.children) {
      if (c.name === 'Trigger') {
        triggers.push({ name: upper(attr(c, 'Name'))!, scope, text: attr(c, 'TriggerText') ?? deepText(c), line: c.line });
      } else if (c.name === 'Block') collect(c, `BLOCK ${upper(attr(c, 'Name'))}`);
      else if (c.name === 'Item') collect(c, `${scope} ITEM ${upper(attr(c, 'Name'))}`);
      else if (c.name !== 'ProgramUnit') collect(c, scope);
    }
  };
  collect(form, 'FORM');

  const programUnits = findAll(form, 'ProgramUnit').map((p) => ({
    name: upper(attr(p, 'Name'))!,
    type: attr(p, 'ProgramUnitType') ?? null,
    text: attr(p, 'ProgramUnitText') ?? deepText(p),
    line: p.line,
  }));
  const recordGroups = findAll(form, 'RecordGroup').map((r) => ({ name: upper(attr(r, 'Name'))!, query: attr(r, 'RecordGroupQuery') ?? null }));
  const lovs = findAll(form, 'LOV').map((l) => ({ name: upper(attr(l, 'Name'))!, recordGroup: upper(attr(l, 'RecordGroupName')) }));
  const libraries = findAll(form, 'AttachedLibrary').map((l) => attr(l, 'Name') ?? '').filter(Boolean);

  const code = [...triggers.map((t) => t.text), ...programUnits.map((p) => p.text), ...recordGroups.map((r) => r.query ?? '')].join(';\n');
  const refs = extractReferences(code);
  const ownUnits = new Set(programUnits.map((p) => p.name));
  const reads = new Set(refs.reads);
  const writes = new Set(refs.writes);
  for (const b of blocks) {
    if (b.dataSource) reads.add(b.dataSource);
    if (b.dmlTarget) writes.add(b.dmlTarget);
  }
  return {
    name,
    blocks,
    triggers,
    programUnits,
    recordGroups,
    lovs,
    libraries,
    refs: {
      reads: [...reads].sort(),
      writes: [...writes].sort(),
      calls: refs.calls.filter((c) => !ownUnits.has(c)),
    },
  };
}

export interface ParsedReport {
  name: string;
  queries: { name: string; sql: string }[];
  dataItems: string[];
  fields: { name: string; source: string | null }[];
  parameters: string[];
  programUnits: { name: string; text: string }[];
  refs: References;
}

/** Parse an Oracle Report exported with rwconverter (dtype=xmlfile). */
export function parseReportXml(xml: string, fallbackName: string): ParsedReport | null {
  const doc = parseXml(xml);
  const report = findAll(doc, 'report')[0];
  if (!report) return null;
  const name = upper(attr(report, 'name')) ?? fallbackName.toUpperCase();
  const queries = findAll(report, 'dataSource').map((ds) => {
    const select = findAll(ds, 'select')[0];
    return { name: upper(attr(ds, 'name')) ?? 'QUERY', sql: select ? deepText(select).trim() : '' };
  });
  const dataItems = findAll(report, 'dataItem').map((d) => upper(attr(d, 'name'))!).filter(Boolean);
  const fields = findAll(report, 'field').map((f) => ({ name: upper(attr(f, 'name'))!, source: upper(attr(f, 'source')) }));
  const parameters = [...findAll(report, 'userParameter'), ...findAll(report, 'systemParameter')].map((p) => upper(attr(p, 'name'))!).filter(Boolean);
  const programUnits = [...findAll(report, 'function'), ...findAll(report, 'procedure'), ...findAll(report, 'packageBody')].map((p) => ({
    name: upper(attr(p, 'name')) ?? 'UNIT',
    text: deepText(p).trim(),
  }));
  const refs = extractReferences([...queries.map((q) => q.sql), ...programUnits.map((p) => p.text)].join(';\n'));
  const own = new Set(programUnits.map((p) => p.name));
  return { name, queries, dataItems, fields, parameters, programUnits, refs: { ...refs, calls: refs.calls.filter((c) => !own.has(c)) } };
}
