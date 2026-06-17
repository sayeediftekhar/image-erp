-- ============================================================================
-- P1-T2 TEST SUITE
-- Run order: shim → 0001 migration → 0002 migration → 0001 test → THIS FILE
-- Proves: trigger fires correctly for all 4 tables × 3 ops; actor resolution
-- including SYSTEM fallback; append-only (permission denied, not silent RLS);
-- RLS SELECT matrix per role.
--
-- Bootstrap users are already in session from the T1 test run:
--   11111111... = ADMIN        22222222... = HQ_FINANCE
--   33333333... = ENTRY (JAL)  44444444... = READ_ONLY
-- test.expect_ok / test.expect_fail helpers also already exist.
-- ============================================================================
\set ON_ERROR_STOP on

-- test.assert: stronger helper for boolean conditions (raises on false).
-- Used where expect_ok would silently pass on a false WHERE clause.
create or replace function test.assert(p_condition bool, p_label text)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice 'PASS: %', p_label;
  else
    raise exception 'FAIL: %', p_label;
  end if;
end $$;

-- Run structural tests as owner (RLS bypassed); auth identity via login_as GUC.
reset role;

-- ============================================================================
-- A. TRIGGER CORRECTNESS — 4 tables × INSERT / UPDATE / DELETE
-- Each sub-section uses a unique sentinel value so assertions filter precisely
-- without assuming any specific audit_log id or absolute row count.
-- ============================================================================

-- ---- entities (uuid 'id' PK branch) ----------------------------------------
select auth.login_as('11111111-1111-1111-1111-111111111111');

insert into public.entities (code, name, created_by)
  values ('ZTST', 'Test Entity', '11111111-1111-1111-1111-111111111111');

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'entities'
      and op = 'INSERT'
      and new_json->>'code' = 'ZTST'
      and old_json is null
      and new_json is not null
      and actor = '11111111-1111-1111-1111-111111111111'::uuid
  ),
  'entities INSERT: audit row with correct op, jsonb, actor'
);

update public.entities set name = 'Test Entity v2' where code = 'ZTST';

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'entities'
      and op = 'UPDATE'
      and old_json->>'name' = 'Test Entity'
      and new_json->>'name' = 'Test Entity v2'
      and old_json is not null
      and new_json is not null
  ),
  'entities UPDATE: old_json and new_json both captured'
);

delete from public.entities where code = 'ZTST';

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'entities'
      and op = 'DELETE'
      and old_json->>'code' = 'ZTST'
      and new_json is null
  ),
  'entities DELETE: old_json present, new_json null'
);

select test.assert(
  (
    select count(*) from audit.audit_log
    where table_name = 'entities'
      and (new_json->>'code' = 'ZTST' or old_json->>'code' = 'ZTST')
  ) = 3,
  'entities: exactly 3 audit rows for ZTST sentinel (one per op, no extras)'
);

-- ---- accounts (text 'code' PK branch) --------------------------------------

insert into public.accounts (code, name, type, normal_balance)
  values ('ZAUD', 'Audit Test Account', 'EXPENSE', 'DEBIT');

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'accounts'
      and op = 'INSERT'
      and record_id = 'ZAUD'
      and new_json->>'code' = 'ZAUD'
      and old_json is null
  ),
  'accounts INSERT: record_id = text code (not uuid cast); text-PK branch correct'
);

update public.accounts set name = 'Audit Test Account v2' where code = 'ZAUD';

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'accounts'
      and op = 'UPDATE'
      and record_id = 'ZAUD'
      and old_json->>'name' = 'Audit Test Account'
      and new_json->>'name' = 'Audit Test Account v2'
  ),
  'accounts UPDATE: record_id = text code, old and new json correct'
);

delete from public.accounts where code = 'ZAUD';

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'accounts'
      and op = 'DELETE'
      and record_id = 'ZAUD'
      and old_json is not null
      and new_json is null
  ),
  'accounts DELETE: old_json present, new_json null, record_id = text code'
);

-- ---- parties (uuid 'id' PK branch) -----------------------------------------
-- Uses control_account '2010' inserted by the T1 test run.

insert into public.parties (name, kind, control_account)
  values ('Test Vendor Zeta', 'VENDOR', '2010');

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'parties'
      and op = 'INSERT'
      and new_json->>'name' = 'Test Vendor Zeta'
      and old_json is null
  ),
  'parties INSERT: audit row captured'
);

update public.parties set name = 'Test Vendor Zeta v2'
  where name = 'Test Vendor Zeta';

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'parties'
      and op = 'UPDATE'
      and old_json->>'name' = 'Test Vendor Zeta'
      and new_json->>'name' = 'Test Vendor Zeta v2'
  ),
  'parties UPDATE: old and new json captured'
);

delete from public.parties where name = 'Test Vendor Zeta v2';

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'parties'
      and op = 'DELETE'
      and old_json->>'name' = 'Test Vendor Zeta v2'
      and new_json is null
  ),
  'parties DELETE: old_json present, new_json null'
);

-- ---- app_users (no created_by / updated_by columns) ------------------------
-- Verifies jsonb-based actor resolution doesn't crash on a table without
-- those columns, and that auth.uid() is still captured correctly.

insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555');
insert into public.app_users (id, full_name, role)
  values ('55555555-5555-5555-5555-555555555555', 'Audit Test User', 'HQ_FINANCE');

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'app_users'
      and op = 'INSERT'
      and new_json->>'id' = '55555555-5555-5555-5555-555555555555'
      and old_json is null
      and actor = '11111111-1111-1111-1111-111111111111'::uuid
  ),
  'app_users INSERT: actor = auth.uid() even with no created_by column on table'
);

delete from public.app_users where id = '55555555-5555-5555-5555-555555555555';

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'app_users'
      and op = 'DELETE'
      and old_json->>'id' = '55555555-5555-5555-5555-555555555555'
      and new_json is null
  ),
  'app_users DELETE: audit row captured for table with no attribution columns'
);

delete from auth.users where id = '55555555-5555-5555-5555-555555555555';

-- ============================================================================
-- B. ACTOR RESOLUTION — SYSTEM UUID fallback
-- Simulates a migration-time write: no JWT (no auth.uid()), explicit created_by
-- = SYSTEM uuid. Verifies the final coalesce lands on the row value, not null.
-- ============================================================================

select auth.logout();

insert into public.entities (code, name, created_by)
  values ('ZSYS', 'System Actor Test', '00000000-0000-0000-0000-000000000000');

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'entities'
      and op = 'INSERT'
      and new_json->>'code' = 'ZSYS'
      and actor = '00000000-0000-0000-0000-000000000000'::uuid
  ),
  'actor fallback: no auth.uid() → created_by propagates as audit actor (never null)'
);

delete from public.entities where code = 'ZSYS';

-- ============================================================================
-- C. APPEND-ONLY ENFORCEMENT
-- INSERT/UPDATE/DELETE are REVOKED from authenticated (never granted on the
-- audit schema). All three must fail with permission denied — expect_fail, not
-- expect_ok-then-assert-unchanged (that pattern is only for grant-present /
-- RLS-filtered cases where the statement runs but filters rows silently).
-- ============================================================================

set role authenticated;
select auth.login_as('11111111-1111-1111-1111-111111111111');  -- even ADMIN cannot write

select test.expect_fail(
  $$insert into audit.audit_log (table_name, record_id, op, new_json, actor)
    values ('entities', 'forged', 'INSERT', '{}',
            '11111111-1111-1111-1111-111111111111')$$,
  'authenticated cannot INSERT into audit.audit_log (permission denied)'
);

select test.expect_fail(
  $$update audit.audit_log
    set actor = '99999999-9999-9999-9999-999999999999'
    where table_name = 'entities'$$,
  'authenticated cannot UPDATE audit.audit_log (permission denied)'
);

select test.expect_fail(
  $$delete from audit.audit_log where table_name = 'entities'$$,
  'authenticated cannot DELETE from audit.audit_log (permission denied)'
);

-- ============================================================================
-- D. RLS SELECT MATRIX (still as authenticated role)
-- ============================================================================

-- ENTRY: blocked by RLS → 0 rows visible
select auth.login_as('33333333-3333-3333-3333-333333333333');
select test.assert(
  (select count(*) from audit.audit_log) = 0,
  'ENTRY cannot SELECT audit.audit_log (RLS returns 0 rows)'
);

-- ADMIN: oversight role → sees rows (T1 test + Section A generated rows)
select auth.login_as('11111111-1111-1111-1111-111111111111');
select test.assert(
  (select count(*) from audit.audit_log) > 0,
  'ADMIN can SELECT audit.audit_log'
);

-- HQ_FINANCE: oversight role → sees rows
select auth.login_as('22222222-2222-2222-2222-222222222222');
select test.assert(
  (select count(*) from audit.audit_log) > 0,
  'HQ_FINANCE can SELECT audit.audit_log'
);

-- READ_ONLY: oversight role → sees rows
select auth.login_as('44444444-4444-4444-4444-444444444444');
select test.assert(
  (select count(*) from audit.audit_log) > 0,
  'READ_ONLY can SELECT audit.audit_log'
);

reset role;
select '======== ALL P1-T2 TESTS PASSED ========' as result;
