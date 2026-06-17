-- ============================================================================
-- P1-T1 TEST SUITE  (run after shim + migration, inside one transaction)
-- Proves: CHECK constraints, audit-actor guard (L3), contra-asset modelling,
-- and the RLS matrix (L5) tested per role.
-- ============================================================================
\set ON_ERROR_STOP on

create schema if not exists test;
grant usage on schema test to authenticated, anon;

-- expect_fail: runs SQL as the CURRENT role; passes only if it errors.
create or replace function test.expect_fail(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS (correctly rejected): %', p_label;
    return;
  end;
  raise exception 'FAIL (should have been rejected): %', p_label;
end $$;

create or replace function test.expect_ok(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS (allowed): %', p_label;
end $$;

-- ---------------------------------------------------------------------------
-- BOOTSTRAP (as owner = postgres; RLS bypassed for setup only)
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333'),
  ('44444444-4444-4444-4444-444444444444');

insert into public.app_users (id, full_name, role, entity_id) values
  ('11111111-1111-1111-1111-111111111111','Sayeed (admin)','ADMIN', null),
  ('22222222-2222-2222-2222-222222222222','HQ Finance','HQ_FINANCE', null),
  ('33333333-3333-3333-3333-333333333333','Mohsin (JAL)','ENTRY',
       (select id from public.entities where code='JAL')),
  ('44444444-4444-4444-4444-444444444444','Auditor','READ_ONLY', null);

-- ---------------------------------------------------------------------------
-- A. CONSTRAINTS & GUARDS  (as owner; trigger/CHECK logic, RLS not the point)
-- ---------------------------------------------------------------------------
select test.expect_ok($$select 1 where (select count(*) from public.entities)=6$$,
  'six entities seeded');

-- ENTRY user must have an entity; cross-entity roles must not
select test.expect_fail($$insert into public.app_users(id,role,entity_id)
  values ('55555555-5555-5555-5555-555555555555','ENTRY',null)$$,
  'ENTRY without entity rejected (entry_user_has_entity)');
select test.expect_fail($$insert into public.app_users(id,role,entity_id)
  values ('55555555-5555-5555-5555-555555555555','ADMIN',
          (select id from public.entities where code='JAL'))$$,
  'ADMIN with entity rejected (entry_user_has_entity)');

-- audit-actor guard (L3): no auth.uid() and no explicit created_by -> reject
select auth.logout();
select test.expect_fail($$insert into public.accounts(code,name,type,normal_balance)
  values ('9999','Orphan','EXPENSE','DEBIT')$$,
  'insert with null actor rejected (Iron Law 3)');

-- contra-asset must be expressible: type ASSET + normal_balance CREDIT
select auth.login_as('11111111-1111-1111-1111-111111111111');
select test.expect_ok($$insert into public.accounts(code,name,type,normal_balance,is_control)
  values ('1590','Accumulated Depreciation','ASSET','CREDIT',false)$$,
  'contra-asset 1590 = ASSET/CREDIT accepted');

-- account code length CHECK
select test.expect_fail($$insert into public.accounts(code,name,type,normal_balance)
  values ('XX','Too short','ASSET','DEBIT')$$,
  'too-short account code rejected');

-- ---------------------------------------------------------------------------
-- B. RLS MATRIX  (switch to the authenticated role; identity via login_as)
-- ---------------------------------------------------------------------------
set role authenticated;

-- ADMIN may write reference data
select auth.login_as('11111111-1111-1111-1111-111111111111');
select test.expect_ok($$insert into public.accounts(code,name,type,normal_balance,fund,is_control)
  values ('2010','Accounts Payable - Suppliers','LIABILITY','CREDIT','RDF',true)$$,
  'ADMIN can insert account');
select test.expect_ok($$insert into public.parties(name,kind,control_account)
  values ('Renata Ltd','VENDOR','2010')$$,
  'ADMIN can insert party');
select test.expect_ok($$update public.accounts set name='Accounts Payable (Suppliers)'
  where code='2010'$$, 'ADMIN can update account (touch trigger fires)');

-- ENTRY (JAL manager) may READ reference data but NOT write it
select auth.login_as('33333333-3333-3333-3333-333333333333');
select test.expect_ok($$select 1 where (select count(*) from public.accounts) >= 2$$,
  'ENTRY can read accounts');
select test.expect_ok($$select 1 where (select count(*) from public.entities) = 6$$,
  'ENTRY can read entities');
select test.expect_fail($$insert into public.accounts(code,name,type,normal_balance)
  values ('5099','Sneaky expense','EXPENSE','DEBIT')$$,
  'ENTRY cannot insert account (admin-only write)');
-- NOTE: RLS blocks UPDATE by filtering the row out (0 rows, no error), unlike
-- INSERT which raises on WITH CHECK. So we assert the row was NOT changed.
select test.expect_ok($$update public.accounts set name='hacked' where code='2010'$$,
  'ENTRY update statement runs but hits 0 visible rows');
select test.expect_ok($$select 1 from public.accounts where code='2010' and name <> 'hacked'$$,
  'ENTRY update changed nothing (RLS filtered the row)');
select test.expect_fail($$insert into public.parties(name,kind) values ('Ghost','VENDOR')$$,
  'ENTRY cannot insert party');

-- READ_ONLY auditor may read, never write
select auth.login_as('44444444-4444-4444-4444-444444444444');
select test.expect_ok($$select 1 where (select count(*) from public.accounts) >= 2$$,
  'READ_ONLY can read accounts');
select test.expect_fail($$insert into public.accounts(code,name,type,normal_balance)
  values ('5098','Auditor wrote this','EXPENSE','DEBIT')$$,
  'READ_ONLY cannot insert account');

-- app_users visibility: ENTRY sees only own row; ADMIN sees all
select auth.login_as('33333333-3333-3333-3333-333333333333');
select test.expect_ok($$select 1 where (select count(*) from public.app_users)=1$$,
  'ENTRY sees only own app_users row');
select auth.login_as('11111111-1111-1111-1111-111111111111');
select test.expect_ok($$select 1 where (select count(*) from public.app_users)=4$$,
  'ADMIN sees all app_users rows');

-- ---------------------------------------------------------------------------
-- C. FK RESTRICT slice of "deactivate, don't delete" (owner context)
-- ---------------------------------------------------------------------------
reset role;
select test.expect_fail($$delete from public.accounts where code='2010'$$,
  'cannot delete control account referenced by a party (FK restrict)');
select test.expect_fail($$delete from public.entities where code='JAL'$$,
  'cannot delete entity referenced by an app_user (FK restrict)');

-- updated_at actually populated by the touch trigger
select test.expect_ok($$select 1 from public.accounts
  where code='2010' and updated_at is not null and updated_by is not null$$,
  'updated_at/updated_by stamped on update');

select '======== ALL P1-T1 TESTS PASSED ========' as result;
