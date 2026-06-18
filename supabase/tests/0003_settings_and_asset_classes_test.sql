-- ============================================================================
-- P1-T3 TEST SUITE
-- Run order: shim → 0001 → 0002 → 0003 → 0001_test → 0002_test → THIS FILE
-- Proves: seed values; generalised audit trigger (id>code>key waterfall);
-- regression for existing tables; RLS matrix; require_actor + touch trigger.
--
-- Bootstrap users already in session from T1 test run:
--   11111111... = ADMIN        22222222... = HQ_FINANCE
--   33333333... = ENTRY (JAL)  44444444... = READ_ONLY
-- test.assert / test.expect_ok / test.expect_fail helpers also exist.
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

-- ============================================================================
-- A. SEED CORRECTNESS
-- ============================================================================

select test.assert(
  (select count(*)::int from public.settings) = 3,
  'settings: exactly 3 rows seeded'
);

select test.assert(
  (select count(*)::int from public.asset_classes) = 6,
  'asset_classes: exactly 6 rows seeded'
);

-- Spot-check: high_value_approval_threshold = 50000
select test.assert(
  (select value from public.settings where key = 'high_value_approval_threshold') = '50000'::jsonb,
  'high_value_approval_threshold seeded as 50000'
);

-- Spot-check: capitalisation_threshold = 10000
select test.assert(
  (select value from public.settings where key = 'capitalisation_threshold') = '10000'::jsonb,
  'capitalisation_threshold seeded as 10000'
);

-- Spot-check: IT annual_rate = 0.2500
select test.assert(
  (select annual_rate from public.asset_classes where code = 'IT') = 0.2500,
  'IT annual_rate = 0.2500'
);

-- Spot-check: BUILDING annual_rate = 0.0500, useful_life_years = 20
select test.assert(
  (select annual_rate from public.asset_classes where code = 'BUILDING') = 0.0500,
  'BUILDING annual_rate = 0.0500'
);
select test.assert(
  (select useful_life_years from public.asset_classes where code = 'BUILDING') = 20,
  'BUILDING useful_life_years = 20'
);

-- All asset_classes seeded as active
select test.assert(
  (select count(*)::int from public.asset_classes where active) = 6,
  'all 6 asset_classes active = true (default)'
);

-- residual_rate defaults to 0 for all
select test.assert(
  (select count(*)::int from public.asset_classes where residual_rate = 0) = 6,
  'all 6 asset_classes residual_rate = 0 (default)'
);

-- ============================================================================
-- B. GENERALISED AUDIT TRIGGER — record_id waterfall + regression
-- The 0003 migration seeds run after the trigger is attached, so audit rows
-- for settings and asset_classes already exist. T1/T2 tests (run before this
-- file) generated accounts and entities audit rows via the new trigger body.
-- ============================================================================

-- settings: seed INSERT generated record_id = key (text PK; no 'id' or 'code' field)
select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'settings'
      and op = 'INSERT'
      and record_id = 'capitalisation_threshold'
      and new_json->>'key' = 'capitalisation_threshold'
      and old_json is null
  ),
  'settings INSERT: record_id = key (waterfall falls through id→code→key)'
);

-- asset_classes: seed INSERT generated record_id = code (text PK; no 'id' or 'key' field)
select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'asset_classes'
      and op = 'INSERT'
      and record_id = 'FURNITURE'
      and new_json->>'code' = 'FURNITURE'
      and old_json is null
  ),
  'asset_classes INSERT: record_id = code (waterfall id→code)'
);

-- Regression — accounts: generalised trigger still yields record_id = text code.
-- Account '2010' is seeded by migration 0006; its INSERT fires the generalised
-- trigger and produces record_id = code (text-PK path). T1 fixture for this
-- account now uses code 'Z010' to avoid a conflict with the 0006 seed.
select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'accounts'
      and record_id = '2010'
      and length(record_id) < 36
  ),
  'regression: accounts audit row has record_id = text code (not uuid cast)'
);

-- Regression — entities: generalised trigger yields record_id = uuid, not 'JAL' etc.
-- entities have both an id (uuid PK) and a code column; id must win.
-- ZTST entity was inserted/updated/deleted in T2 test; uuid is in record_id.
select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'entities'
      and record_id is not null
      and length(record_id) = 36
  ),
  'regression: entities audit rows have record_id = uuid (id field wins over code field)'
);

-- Belt-and-suspenders: no entities audit row has record_id = a short text code
select test.assert(
  not exists (
    select 1 from audit.audit_log
    where table_name = 'entities'
      and length(record_id) < 10
  ),
  'regression: no entities audit row has a short text code as record_id'
);

-- ============================================================================
-- C. RLS MATRIX
-- ============================================================================

set role authenticated;

-- ADMIN can INSERT into both tables
select auth.login_as('11111111-1111-1111-1111-111111111111');

select test.expect_ok($$
  insert into public.settings (key, value, description)
    values ('ZADMIN_TEST', '1', 'admin write test')
$$, 'ADMIN can INSERT settings');

select test.expect_ok($$
  insert into public.asset_classes (code, name, useful_life_years, annual_rate)
    values ('ZADMIN_AC', 'Admin Test AC', 3, 0.3333)
$$, 'ADMIN can INSERT asset_classes');

-- ENTRY can SELECT both tables
select auth.login_as('33333333-3333-3333-3333-333333333333');

select test.assert(
  (select count(*)::int from public.settings) >= 3,
  'ENTRY can SELECT settings'
);
select test.assert(
  (select count(*)::int from public.asset_classes) >= 6,
  'ENTRY can SELECT asset_classes'
);

-- ENTRY cannot INSERT settings (grant present; WITH CHECK rejects → exception)
select test.expect_fail($$
  insert into public.settings (key, value, description)
    values ('ENTRY_HACK', '999', 'entry write attempt')
$$, 'ENTRY cannot INSERT settings (RLS WITH CHECK rejects)');

-- ENTRY UPDATE on settings: grant present, USING false → 0 rows silently
-- (same pattern as ENTRY UPDATE on accounts in T1 tests; assert unchanged)
select test.expect_ok($$
  update public.settings set value = '9999'
    where key = 'capitalisation_threshold'
$$, 'ENTRY UPDATE on settings: statement runs, 0 visible rows (RLS USING filters)');

select test.assert(
  (select value from public.settings where key = 'capitalisation_threshold') = '10000'::jsonb,
  'ENTRY UPDATE changed nothing (row was invisible; value still 10000)'
);

-- READ_ONLY cannot INSERT settings (WITH CHECK rejects)
select auth.login_as('44444444-4444-4444-4444-444444444444');

select test.expect_fail($$
  insert into public.settings (key, value)
    values ('RO_HACK', '0')
$$, 'READ_ONLY cannot INSERT settings (RLS WITH CHECK rejects)');

-- ============================================================================
-- D. REQUIRE_ACTOR + TOUCH TRIGGER
-- ============================================================================

reset role;
select auth.logout();

-- No JWT + no explicit created_by → require_actor raises (Iron Law 3)
select test.expect_fail($$
  insert into public.settings (key, value) values ('NULL_ACTOR_TEST', '0')
$$, 'settings INSERT with null actor rejected (require_actor / Iron Law 3)');

select test.expect_fail($$
  insert into public.asset_classes (code, name, useful_life_years, annual_rate)
    values ('NULL_ACTOR_AC', 'test', 5, 0.2000)
$$, 'asset_classes INSERT with null actor rejected (require_actor / Iron Law 3)');

-- Touch trigger stamps updated_by + updated_at on UPDATE
select auth.login_as('11111111-1111-1111-1111-111111111111');

insert into public.asset_classes (code, name, useful_life_years, annual_rate)
  values ('ZTOUCH', 'Touch Test AC', 5, 0.2000);
update public.asset_classes set name = 'Touch Test AC v2' where code = 'ZTOUCH';

select test.assert(
  exists (
    select 1 from public.asset_classes
    where code = 'ZTOUCH'
      and updated_at is not null
      and updated_by = '11111111-1111-1111-1111-111111111111'::uuid
  ),
  'touch trigger stamps updated_at and updated_by on asset_classes UPDATE'
);

-- Touch trigger on settings
insert into public.settings (key, value) values ('ZTOUCH_S', '1');
update public.settings set value = '2' where key = 'ZTOUCH_S';

select test.assert(
  exists (
    select 1 from public.settings
    where key = 'ZTOUCH_S'
      and updated_at is not null
      and updated_by = '11111111-1111-1111-1111-111111111111'::uuid
  ),
  'touch trigger stamps updated_at and updated_by on settings UPDATE'
);

-- ============================================================================
-- CLEANUP test rows (as owner, bypassing RLS)
-- ============================================================================
delete from public.settings      where key  in ('ZADMIN_TEST', 'ZTOUCH_S');
delete from public.asset_classes where code in ('ZADMIN_AC', 'ZTOUCH');

reset role;
select '======== ALL P1-T3 TESTS PASSED ========' as result;
