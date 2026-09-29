---
name: secure-plsql
description: Security review for Oracle Forms, Reports and PL/SQL changes: SQL injection, privilege and definer rights, secrets, personal data exposure, and audit requirements.
---

# Secure PL/SQL and Forms review

Run each check and record `pass`, `fail` or `not_applicable` with a note.

1. **SQL injection**: any `EXECUTE IMMEDIATE`, `DBMS_SQL`, `OPEN ... FOR` with string concatenation of variables; Reports lexical parameters (`&P_...`); Forms `FORMS_DDL` or record-group queries built from item values. Required: bind variables, `DBMS_ASSERT` for identifiers.
2. **Privileges**: new `AUTHID DEFINER` routines that expose privileged operations; new `GRANT` statements (to PUBLIC is a fail); roles granted in scripts.
3. **Secrets**: passwords, keys, connection strings or tokens in code, scripts, comments or test data.
4. **Personal data**: new personal fields shown in logs (`DBMS_OUTPUT`, error messages, audit text), exported to files, or shown in reports without the project's masking rule. Test scripts must use synthetic data.
5. **Audit**: changes to customer master data are captured by the existing audit mechanism (audit triggers/tables include new columns).
6. **Error handling**: no `WHEN OTHERS THEN NULL`; error messages do not leak internal structure to end users.
7. **Input validation**: lengths and formats enforced server-side (package), not only in the form.
8. **Dependencies**: no new database links, external calls (`UTL_HTTP`, `UTL_FILE`) without an explicit plan item.

`approved` is false if any check fails with a blocker or major finding. Cite file and line for each finding.
