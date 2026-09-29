---
name: oracle-forms
description: Read and safely modify Oracle Forms modules through their XML export (frmf2xml/frmxml2f), including blocks, items, triggers, program units, LOVs, canvases and compilation.
---

# Oracle Forms

## Files

- `.fmb` is binary. Never edit it. Convert with `oracle_form_to_xml` → `<NAME>_fmb.xml`, edit the XML, convert back with `oracle_xml_to_form`, then compile with `oracle_compile_form` (produces `.fmx` and an `.err` log).
- Commit the `.fmb` (source of truth for the team) and, if the repository already tracks them, the `_fmb.xml`.
- `.pll` libraries and `.mmb` menus follow the same idea; do not change them unless the plan says so.

## XML structure (frmf2xml)

```
<Module><FormModule Name="...">
  <Block Name="CUSTOMER" QueryDataSourceName="CUSTOMER" DMLDataTargetName="CUSTOMER">
    <Item Name="ADDRESS" ItemType="Text Item" DataType="Char" MaximumLength="400"
          ColumnName="ADDRESS" CanvasName="CV_MAIN" XPosition=".." YPosition=".." Width=".." Height=".."
          Prompt="Address" Required="false">
      <Trigger Name="WHEN-VALIDATE-ITEM" TriggerText="..."/>
    </Item>
    <Trigger Name="POST-QUERY" TriggerText="..."/>
  </Block>
  <Canvas Name="CV_MAIN" .../>
  <ProgramUnit Name="..." ProgramUnitType="Procedure" ProgramUnitText="..."/>
  <RecordGroup .../> <LOV .../>
  <Trigger Name="WHEN-NEW-FORM-INSTANCE" TriggerText="..."/>
</FormModule></Module>
```

- `TriggerText` and `ProgramUnitText` are XML attribute values: newlines are `&#10;`, quotes `&quot;`, `<` is `&lt;`, `&` is `&amp;`. Keep this escaping exact when editing.

## Adding a database item

1. Copy an existing, similar item in the same block (same canvas, same data type) as the template. Keep attribute order and style.
2. Set `Name`, `ColumnName`, `DataType`, `MaximumLength` (must be ≤ the column length), `Prompt`, and canvas position. Position it where it does not overlap: check X/Y/Width/Height of neighbours.
3. Set `Required` to match the rule (usually `false` for a new column on existing data, enforce in validation if mandatory only for new records).
4. Add validation in `WHEN-VALIDATE-ITEM` (item level) calling the package routine, not inline business logic.
5. Check block-level triggers that list columns explicitly (`ON-INSERT`, `ON-UPDATE`, `POST-INSERT` audit inserts, `PRE-UPDATE`), and any `SELECT ... INTO` in `POST-QUERY` for non-base-table items.
6. Navigation: `NextNavigationItemName` / `PreviousNavigationItemName` if the form defines explicit tab order.

## Rules

- Business rules belong in PL/SQL packages in the database; triggers call them. Keep triggers thin.
- Use `:BLOCK.ITEM` references; do not rely on `:SYSTEM.CURSOR_ITEM` for business logic.
- After converting back, always compile. A form that does not compile is not done. Read the `.err` log and fix every error.
- If Forms tooling is not available on this runner, say so as a blocker; do not hand-edit the `.fmb`.
