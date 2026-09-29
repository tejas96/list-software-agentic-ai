import { describe, expect, it } from 'vitest';
import { buildGraph, chunkText } from './graph.js';
import { graphFromGraphify, graphFromOracleMetadata } from './importers.js';
import { parseFormXml, parseReportXml } from './oracle-modules.js';
import { extractReferences, parseColumns, parsePlsqlFile, stripCommentsAndStrings } from './plsql.js';

const PKG = `
-- Customer package
CREATE OR REPLACE PACKAGE BODY app.pkg_customer AS
  PROCEDURE validate_address(p_addr IN VARCHAR2) IS
  BEGIN
    IF p_addr IS NULL THEN
      raise_application_error(-20001, 'Address is required; FROM nowhere');
    END IF;
  END validate_address;

  FUNCTION create_customer(p_name VARCHAR2, p_addr VARCHAR2) RETURN NUMBER IS
    l_id customer.customer_id%TYPE;
  BEGIN
    validate_address(p_addr);
    INSERT INTO customer (customer_id, name, address) VALUES (customer_seq.NEXTVAL, p_name, p_addr)
      RETURNING customer_id INTO l_id;
    UPDATE account a SET a.status = 'OPEN' WHERE a.customer_id = l_id;
    audit_pkg.log_event('CREATE', l_id);
    SELECT count(*) INTO l_id FROM account_type t, branch b WHERE b.id = t.branch_id;
    RETURN l_id;
  END create_customer;
END pkg_customer;
/
CREATE TABLE customer (
  customer_id NUMBER(10) NOT NULL,
  name VARCHAR2(200),
  address VARCHAR2(400),
  CONSTRAINT customer_pk PRIMARY KEY (customer_id)
);
`;

describe('PL/SQL scanner', () => {
  it('blanks comments and strings but keeps lines', () => {
    const s = stripCommentsAndStrings("a -- x FROM t\n'FROM y' /* z\nFROM w */ b");
    expect(s).not.toMatch(/FROM/);
    expect(s.split('\n')).toHaveLength(3);
  });

  it('finds units, members, reads, writes and calls', () => {
    const units = parsePlsqlFile(PKG);
    expect(units.map((u) => `${u.kind}:${u.name}`)).toEqual([
      'plsql_package:PKG_CUSTOMER',
      'db_table:CUSTOMER',
    ]);
    const pkg = units[0]!;
    expect(pkg.schema).toBe('APP');
    expect(pkg.members).toEqual(['VALIDATE_ADDRESS', 'CREATE_CUSTOMER']);
    expect(pkg.refs.writes).toEqual(['ACCOUNT', 'CUSTOMER']);
    expect(pkg.refs.reads).toEqual(expect.arrayContaining(['ACCOUNT_TYPE', 'BRANCH', 'CUSTOMER']));
    expect(pkg.refs.calls).toContain('AUDIT_PKG.LOG_EVENT');
    expect(pkg.refs.calls).not.toContain('VALIDATE_ADDRESS'); // own member
    expect(pkg.refs.reads).not.toContain('NOWHERE'); // inside a string
    expect(pkg.startLine).toBe(3);
  });

  it('reads table columns', () => {
    expect(
      parseColumns('create table t (a number(10) not null, b varchar2(20), constraint pk primary key (a))'),
    ).toEqual([
      { name: 'A', type: 'NUMBER(10)' },
      { name: 'B', type: 'VARCHAR2(20)' },
    ]);
  });

  it('extracts references from joins', () => {
    const r = extractReferences('select * from a join b on a.id = b.id left join c on c.x = b.x');
    expect(r.reads).toEqual(['A', 'B', 'C']);
  });
});

const FORM = `<?xml version="1.0" encoding="UTF-8"?>
<Module version="101020002" xmlns="http://xmlns.oracle.com/Forms">
  <FormModule Name="CUSTOMER_ACCOUNT" Title="Customer account">
    <Block Name="CUSTOMER" QueryDataSourceName="CUSTOMER">
      <Item Name="NAME" ItemType="Text Item" DataType="Char" MaximumLength="200" ColumnName="NAME"/>
      <Item Name="ADDRESS" ItemType="Text Item" DataType="Char" MaximumLength="400" ColumnName="ADDRESS">
        <Trigger Name="WHEN-VALIDATE-ITEM" TriggerText="pkg_customer.validate_address(:customer.address);"/>
      </Item>
      <Trigger Name="POST-INSERT" TriggerText="INSERT INTO customer_audit (id) VALUES (:customer.customer_id);&#10;commit_log;"/>
    </Block>
    <ProgramUnit Name="COMMIT_LOG" ProgramUnitType="Procedure" ProgramUnitText="PROCEDURE commit_log IS BEGIN null; END;"/>
    <RecordGroup Name="RG_BRANCH" RecordGroupQuery="select id, name from branch order by name"/>
    <LOV Name="LOV_BRANCH" RecordGroupName="RG_BRANCH"/>
  </FormModule>
</Module>`;

const REPORT = `<?xml version="1.0"?>
<report name="CUSTOMER_SUMMARY" DTDVersion="9.0.2.0.10">
  <data>
    <userParameter name="P_BRANCH" datatype="number"/>
    <dataSource name="Q_CUSTOMER">
      <select><![CDATA[SELECT c.name, c.address FROM customer c WHERE c.branch_id = :P_BRANCH]]></select>
      <group name="G_CUSTOMER"><dataItem name="NAME"/><dataItem name="ADDRESS"/></group>
    </dataSource>
  </data>
  <layout><section name="main"><field name="F_ADDRESS" source="ADDRESS"/></section></layout>
  <programUnits><function name="cf_total"><textSource><![CDATA[function cf_total return number is begin return fmt_pkg.total(1); end;]]></textSource></function></programUnits>
</report>`;

describe('Oracle modules', () => {
  it('parses a Forms XML export', () => {
    const f = parseFormXml(FORM, 'x')!;
    expect(f.name).toBe('CUSTOMER_ACCOUNT');
    expect(f.blocks[0]!.items.map((i) => i.name)).toEqual(['NAME', 'ADDRESS']);
    expect(f.triggers.map((t) => `${t.scope}:${t.name}`)).toEqual([
      'BLOCK CUSTOMER ITEM ADDRESS:WHEN-VALIDATE-ITEM',
      'BLOCK CUSTOMER:POST-INSERT',
    ]);
    expect(f.refs.calls).toContain('PKG_CUSTOMER.VALIDATE_ADDRESS');
    expect(f.refs.calls).not.toContain('COMMIT_LOG');
    expect(f.refs.reads).toEqual(expect.arrayContaining(['BRANCH', 'CUSTOMER']));
    expect(f.refs.writes).toEqual(expect.arrayContaining(['CUSTOMER', 'CUSTOMER_AUDIT']));
  });

  it('parses a Reports XML export', () => {
    const r = parseReportXml(REPORT, 'x')!;
    expect(r.name).toBe('CUSTOMER_SUMMARY');
    expect(r.refs.reads).toEqual(['CUSTOMER']);
    expect(r.fields).toEqual([{ name: 'F_ADDRESS', source: 'ADDRESS' }]);
    expect(r.refs.calls).toContain('FMT_PKG.TOTAL');
  });
});

describe('graph building', () => {
  it('turns a repository into objects and references', () => {
    const g = buildGraph([
      { path: 'db/pkg_customer.pkb', content: PKG },
      { path: 'forms/CUSTOMER_ACCOUNT_fmb.xml', content: FORM },
      { path: 'reports/CUSTOMER_SUMMARY_rdf.xml', content: REPORT },
      { path: 'forms/LEGACY.fmb', content: null, binary: true },
      { path: 'README.md', content: '# Core banking' },
      { path: 'image.png', content: null, binary: true },
    ]);
    const names = g.objects.map((o) => `${o.kind}:${o.name}`).sort();
    expect(names).toEqual([
      'db_table:CUSTOMER',
      'file:README.md',
      'form_block:CUSTOMER_ACCOUNT.CUSTOMER',
      'oracle_form:CUSTOMER_ACCOUNT',
      'oracle_form:LEGACY',
      'oracle_report:CUSTOMER_SUMMARY',
      'plsql_package:PKG_CUSTOMER',
    ]);
    const formToPkg = g.refs.find(
      (r) => r.from.name === 'CUSTOMER_ACCOUNT' && r.kind === 'calls' && r.toName === 'PKG_CUSTOMER',
    );
    expect(formToPkg).toBeDefined();
    const reportReads = g.refs.find((r) => r.from.name === 'CUSTOMER_SUMMARY' && r.kind === 'reads');
    expect(reportReads?.toName).toBe('CUSTOMER');
    expect(g.objects.find((o) => o.name === 'LEGACY')!.metadata.needsConversion).toBe(true);
  });

  it('chunks long text with overlap and line numbers', () => {
    const text = Array.from({ length: 130 }, (_, i) => `line ${i + 1}`).join('\n');
    const c = chunkText(text, 1, 60, 10);
    expect(c.map((x) => [x.startLine, x.endLine])).toEqual([
      [1, 60],
      [51, 110],
      [101, 130],
    ]);
  });
});

describe('importers', () => {
  it('imports the Oracle data dictionary', () => {
    const g = graphFromOracleMetadata({
      objects: [
        {
          owner: 'APP',
          name: 'CUSTOMER',
          type: 'TABLE',
          status: 'VALID',
          source: null,
          columns: [{ name: 'ADDRESS', dataType: 'VARCHAR2', nullable: true }],
        },
        {
          owner: 'APP',
          name: 'PKG_CUSTOMER',
          type: 'PACKAGE',
          status: 'VALID',
          source: 'PACKAGE pkg_customer AS PROCEDURE p; END;',
          columns: [],
        },
        {
          owner: 'APP',
          name: 'PKG_CUSTOMER',
          type: 'PACKAGE BODY',
          status: 'INVALID',
          source: 'PACKAGE BODY pkg_customer AS PROCEDURE p IS BEGIN null; END; END;',
          columns: [],
        },
      ],
      dependencies: [
        {
          owner: 'APP',
          name: 'PKG_CUSTOMER',
          type: 'PACKAGE BODY',
          refOwner: 'APP',
          refName: 'CUSTOMER',
          refType: 'TABLE',
        },
      ],
    });
    expect(g.objects).toHaveLength(2);
    const pkg = g.objects.find((o) => o.kind === 'plsql_package')!;
    expect(pkg.metadata.invalid).toBe(true);
    expect(pkg.metadata.members).toEqual(['P']);
    expect(g.refs).toEqual([
      {
        from: { kind: 'plsql_package', name: 'PKG_CUSTOMER' },
        toName: 'CUSTOMER',
        toKinds: ['db_table'],
        kind: 'reads',
      },
    ]);
  });

  it('imports a Graphify node-link graph', () => {
    const g = graphFromGraphify({
      nodes: [
        { id: 'a', label: 'AccountService', type: 'class', file: 'src/AccountService.java' },
        { id: 'b', label: 'openAccount', type: 'method', file: 'src/AccountService.java' },
      ],
      links: [{ source: 'a', target: 'b', relation: 'contains' }],
    });
    expect(g.objects.map((o) => o.kind)).toEqual(['class', 'function']);
    expect(g.refs[0]).toMatchObject({ kind: 'contains', toName: 'src/AccountService.java#openAccount' });
    expect(graphFromGraphify({}).warnings).toHaveLength(1);
  });
});
