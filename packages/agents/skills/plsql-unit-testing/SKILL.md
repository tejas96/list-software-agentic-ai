---
name: plsql-unit-testing
description: Write and run automated database tests with utPLSQL or plain PL/SQL test scripts against the sandbox schema, with isolated test data.
---

# PL/SQL unit testing

## With utPLSQL (if installed in the sandbox)

```sql
create or replace package test_pkg_customer as
  --%suite(PKG_CUSTOMER)
  --%rollback(auto)

  --%test(Creating a customer saves the address)
  procedure create_saves_address;

  --%test(Validation rejects an empty address when required)
  --%throws(-20001)
  procedure empty_address_rejected;
end;
/
```

Run with `oracle_run_sql`: `begin ut.run('test_pkg_customer'); end;` and read the output (or query `ut3` results). Tests roll back automatically.

## Without utPLSQL

Write `tests/db/test_<object>.sql` as an anonymous block:

```sql
declare
  l_id customer.customer_id%type;
  l_addr customer.address%type;
begin
  savepoint t;
  l_id := pkg_customer.create_customer('Test Person', '1 Test Street');
  select address into l_addr from customer where customer_id = l_id;
  if l_addr is null or l_addr != '1 Test Street' then
    raise_application_error(-20999, 'FAIL create_saves_address: got ' || nvl(l_addr, 'NULL'));
  end if;
  rollback to t;
  dbms_output.put_line('PASS create_saves_address');
exception when others then
  rollback to t;
  raise;
end;
```

## Rules

- Test data is synthetic and obviously fake ("Test Person"), never copied from real customers.
- Each test cleans up (rollback) so tests are independent and re-runnable.
- A test that cannot run (no sandbox, missing grant) is `blocked`, not `passed`. Say what is missing.
- Record the exact command/statement used and a short log excerpt in the results.
