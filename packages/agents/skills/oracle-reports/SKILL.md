---
name: oracle-reports
description: Read and modify Oracle Reports (.rdf) through XML (rwconverter): data model queries, groups, data items, formulas, parameters and layout fields.
---

# Oracle Reports

## Files

- `.rdf` is binary. Convert with `oracle_report_to_xml` (`<NAME>_rdf.xml`), edit, convert back with `oracle_xml_to_report`.
- Some repositories keep `.jsp` or `.xml` reports; edit those directly.

## XML structure

```
<report name="CUSTOMER_SUMMARY">
  <data>
    <userParameter name="P_BRANCH" datatype="number"/>
    <dataSource name="Q_CUSTOMER">
      <select><![CDATA[ SELECT c.customer_id, c.name, c.address FROM customer c ... ]]></select>
      <group name="G_CUSTOMER">
        <dataItem name="ADDRESS" datatype="vchar2" columnOrder="3" width="400" .../>
      </group>
    </dataSource>
    <formula name="CF_TOTAL" source="cf_totalformula" datatype="number"/>
  </data>
  <layout> ... <field name="F_ADDRESS" source="ADDRESS" x=".." y=".." width=".." height=".."/> ... </layout>
  <programUnits> <function name="cf_totalformula"> <textSource><![CDATA[ ... ]]></textSource> </function> </programUnits>
</report>
```

## Adding a column to a report

1. Add the column to the query `SELECT` (explicit column, never `*`).
2. Add a matching `dataItem` in the right group with correct `datatype`, `width` and `columnOrder`.
3. Add a layout `field` with `source` = the data item, placed in the repeating frame of that group. Copy a neighbouring field's font and format attributes; adjust frame width if the layout would overflow.
4. Masking: if the value is personal data and the report is external-facing, confirm whether it should be masked.
5. Convert back and, when possible, run the report in the sandbox with a known parameter set; compare output with the expected rows.

## Rules

- Keep query changes minimal; do not reformat the whole SQL (reviewers need a readable diff).
- Parameters: never concatenate into SQL; use bind references (`:P_BRANCH`).
- Lexical parameters (`&P_WHERE`) are an injection risk; flag any new use to Security.
