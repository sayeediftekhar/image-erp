-- ============================================================================
-- P1-T7 TEST SUITE: fixed_assets + bank_feed
-- Run order: shim → 0001–0009 → 0001_test → … → 0008_test → THIS FILE
-- Proves:
--   1. fixed_assets: valid insert succeeds; accumulated_depreciation defaults 0
--   2. fixed_assets: cost < 0 rejected (CHECK)
--   3. fixed_assets: bad asset_class FK rejected
--   4. fixed_assets: active defaults true; deactivate (set false) works
--   5. bank_feed: valid insert succeeds
--   6. bank_feed: dedup guard — same (account_code, source_ref) rejected
--   7. bank_feed: two rows with source_ref=NULL both succeed (partial index exempts nulls)
--   8. bank_feed: bad account_code FK rejected
--   9. bank_feed: bad entity_id FK rejected
--  10. RLS ENTRY: JAL user sees only JAL fixed_assets (NAS row invisible)
--  11. RLS ENTRY: JAL user sees only JAL bank_feed (NAS row invisible)
--  12. RLS ADMIN: sees all fixed_assets (JAL + NAS rows)
--  13. RLS ADMIN: sees all bank_feed (JAL + NAS rows)
--  14. Write denial: authenticated ENTRY INSERT into fixed_assets → permission denied
--  15. Write denial: authenticated ENTRY INSERT into bank_feed → permission denied
--  16. Audit: fixed_assets INSERT → audit row with record_id = uuid id
--  17. require_actor: INSERT with no auth.uid() → null-actor rejected (Iron Law 3)
--
-- Pre-specified UUIDs (prefix 'd' to avoid collision with 'b' 0005 and 'c' 0008):
--   d0000001-... = JAL fixed_asset
--   d0000002-... = NAS fixed_asset
--   d0000003-... = JAL bank_feed row
--   d0000004-... = NAS bank_feed row
--
-- App users (left by 0001_dimension_schema_test.sql; no re-insert needed):
--   11111111-... = ADMIN
--   22222222-... = HQ_FINANCE
--   33333333-... = ENTRY / JAL entity
--   44444444-... = READ_ONLY
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

-- ============================================================================
-- SETUP — four rows inserted as owner (RLS bypassed; service_role pattern)
-- ============================================================================

reset role;

insert into public.fixed_assets
  (id, entity_id, name, asset_class, purchase_date, cost, created_by)
values (
  'd0000001-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'JAL'),
  'JAL Ultrasound Machine', 'MEDICAL', '2025-01-15', 250000.00,
  '11111111-1111-1111-1111-111111111111'
);

insert into public.fixed_assets
  (id, entity_id, name, asset_class, purchase_date, cost, created_by)
values (
  'd0000002-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'NAS'),
  'NAS Desktop Computer', 'IT', '2025-03-01', 75000.00,
  '11111111-1111-1111-1111-111111111111'
);

insert into public.bank_feed
  (id, entity_id, account_code, statement_date, statement_balance, source_ref, created_by)
values (
  'd0000003-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'JAL'),
  '1110', '2026-05-31', 1234567.89, 'SMS-2026-05-31-001',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.bank_feed
  (id, entity_id, account_code, statement_date, statement_balance, source_ref, created_by)
values (
  'd0000004-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'NAS'),
  '1110', '2026-05-31', 987654.32, 'SMS-2026-05-31-002',
  '11111111-1111-1111-1111-111111111111'
);

-- ============================================================================
-- CRITERION 1 — valid fixed_asset insert: accumulated_depreciation defaults 0
-- ============================================================================

select test.assert(
  (select accumulated_depreciation from public.fixed_assets
    where id = 'd0000001-0000-0000-0000-000000000000') = 0,
  'fixed_assets: accumulated_depreciation defaults 0 on insert'
);

select test.assert(
  (select active from public.fixed_assets
    where id = 'd0000001-0000-0000-0000-000000000000') = true,
  'fixed_assets: active defaults true'
);

-- ============================================================================
-- CRITERION 2 — cost < 0 rejected (CHECK constraint)
-- ============================================================================

select test.expect_fail($$
  insert into public.fixed_assets
    (entity_id, name, asset_class, purchase_date, cost, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    'Negative cost asset', 'IT', '2026-01-01', -1000.00,
    '11111111-1111-1111-1111-111111111111'
  )
$$, 'fixed_assets: cost < 0 rejected by CHECK (cost >= 0)');

-- ============================================================================
-- CRITERION 3 — bad asset_class FK rejected
-- ============================================================================

select test.expect_fail($$
  insert into public.fixed_assets
    (entity_id, name, asset_class, purchase_date, cost, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    'Bad class asset', 'NONEXISTENT', '2026-01-01', 10000.00,
    '11111111-1111-1111-1111-111111111111'
  )
$$, 'fixed_assets: non-existent asset_class FK rejected');

-- ============================================================================
-- CRITERION 4 — active defaults true; deactivate (set false) works
-- ============================================================================

update public.fixed_assets
  set active = false
  where id = 'd0000002-0000-0000-0000-000000000000';

select test.assert(
  (select active from public.fixed_assets
    where id = 'd0000002-0000-0000-0000-000000000000') = false,
  'fixed_assets: active can be set to false (deactivate pattern)'
);

-- Restore for later RLS count assertions
update public.fixed_assets
  set active = true
  where id = 'd0000002-0000-0000-0000-000000000000';

-- ============================================================================
-- CRITERION 5 — bank_feed valid insert succeeds
-- ============================================================================

select test.assert(
  (select statement_balance from public.bank_feed
    where id = 'd0000003-0000-0000-0000-000000000000') = 1234567.89,
  'bank_feed: valid insert succeeded; statement_balance stored correctly'
);

-- ============================================================================
-- CRITERION 6 — dedup guard: same (account_code, source_ref) rejected
-- ============================================================================

select test.expect_fail($$
  insert into public.bank_feed
    (entity_id, account_code, statement_date, statement_balance, source_ref, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    '1110', '2026-06-30', 1111111.00, 'SMS-2026-05-31-001',
    '11111111-1111-1111-1111-111111111111'
  )
$$, 'bank_feed: duplicate (account_code, source_ref) rejected by partial unique index');

-- ============================================================================
-- CRITERION 7 — two rows with source_ref=NULL both succeed (partial index exempts nulls)
-- ============================================================================

insert into public.bank_feed
  (entity_id, account_code, statement_date, statement_balance, source_ref, created_by)
values (
  (select id from public.entities where code = 'JAL'),
  '1110', '2026-04-30', 999999.00, null,
  '11111111-1111-1111-1111-111111111111'
);

insert into public.bank_feed
  (entity_id, account_code, statement_date, statement_balance, source_ref, created_by)
values (
  (select id from public.entities where code = 'JAL'),
  '1110', '2026-03-31', 888888.00, null,
  '11111111-1111-1111-1111-111111111111'
);

select test.assert(
  (select count(*)::int from public.bank_feed
    where entity_id = (select id from public.entities where code = 'JAL')
      and source_ref is null) = 2,
  'bank_feed: two rows with source_ref=NULL both accepted (partial index exempts nulls)'
);

-- Clean up the null-source_ref rows; they were just for the dedup test
delete from public.bank_feed
  where entity_id = (select id from public.entities where code = 'JAL')
    and source_ref is null;

-- ============================================================================
-- CRITERION 8 — bad account_code FK rejected
-- ============================================================================

select test.expect_fail($$
  insert into public.bank_feed
    (entity_id, account_code, statement_date, statement_balance, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    'ZZZZ', '2026-01-31', 100.00,
    '11111111-1111-1111-1111-111111111111'
  )
$$, 'bank_feed: non-existent account_code FK rejected');

-- ============================================================================
-- CRITERION 9 — bad entity_id FK rejected
-- ============================================================================

select test.expect_fail($$
  insert into public.bank_feed
    (entity_id, account_code, statement_date, statement_balance, created_by)
  values (
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '1110', '2026-01-31', 100.00,
    '11111111-1111-1111-1111-111111111111'
  )
$$, 'bank_feed: non-existent entity_id FK rejected');

-- ============================================================================
-- CRITERIA 10 & 11 — RLS ENTRY: JAL user sees only JAL rows (NAS invisible)
-- ============================================================================

set role authenticated;
select auth.login_as('33333333-3333-3333-3333-333333333333');

select test.assert(
  (select count(*)::int from public.fixed_assets) = 1,
  'RLS ENTRY: JAL user sees exactly 1 fixed_asset (JAL only; NAS invisible)'
);

select test.assert(
  (select count(*)::int from public.fixed_assets
    where entity_id = (select id from public.entities where code = 'JAL')) = 1,
  'RLS ENTRY: the 1 visible fixed_asset belongs to JAL'
);

-- Only JAL row visible; d0000004 is NAS → invisible.
select test.assert(
  (select count(*)::int from public.bank_feed) = 1,
  'RLS ENTRY: JAL user sees exactly 1 bank_feed row (NAS row d0000004 invisible)'
);

select test.assert(
  (select count(*)::int from public.bank_feed
    where entity_id = (select id from public.entities where code = 'JAL')) = 1,
  'RLS ENTRY: the 1 visible bank_feed row belongs to JAL'
);

-- ============================================================================
-- CRITERIA 12 & 13 — RLS ADMIN: sees all rows
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');
set role authenticated;

select test.assert(
  (select count(*)::int from public.fixed_assets) = 2,
  'RLS ADMIN: sees all 2 fixed_assets (JAL + NAS)'
);

select test.assert(
  (select count(*)::int from public.bank_feed) = 2,
  'RLS ADMIN: sees all 2 bank_feed rows (JAL + NAS)'
);

-- ============================================================================
-- CRITERIA 14 & 15 — Write denial: authenticated INSERT → permission denied
-- ============================================================================

reset role;
select auth.login_as('33333333-3333-3333-3333-333333333333');
set role authenticated;

select test.expect_fail($$
  insert into public.fixed_assets
    (entity_id, name, asset_class, purchase_date, cost, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    'Sneaky insert', 'IT', '2026-01-01', 1000.00,
    '33333333-3333-3333-3333-333333333333'
  )
$$, 'Write denial: authenticated ENTRY INSERT into fixed_assets → permission denied');

select test.expect_fail($$
  insert into public.bank_feed
    (entity_id, account_code, statement_date, statement_balance, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    '1110', '2026-06-30', 500.00,
    '33333333-3333-3333-3333-333333333333'
  )
$$, 'Write denial: authenticated ENTRY INSERT into bank_feed → permission denied');

-- ============================================================================
-- CRITERION 16 — Audit: fixed_assets INSERT → audit row with record_id = uuid id
-- ============================================================================

reset role;

select test.assert(
  exists (
    select 1 from audit.audit_log
     where table_name = 'fixed_assets'
       and record_id = 'd0000001-0000-0000-0000-000000000000'
       and op = 'INSERT'
  ),
  'Audit: fixed_assets INSERT generated audit row with record_id = uuid id'
);

select test.assert(
  exists (
    select 1 from audit.audit_log
     where table_name = 'bank_feed'
       and record_id = 'd0000003-0000-0000-0000-000000000000'
       and op = 'INSERT'
  ),
  'Audit: bank_feed INSERT generated audit row with record_id = uuid id'
);

-- ============================================================================
-- CRITERION 17 — require_actor: INSERT with no auth.uid() → null-actor rejected
-- ============================================================================

select auth.logout();

select test.expect_fail($$
  insert into public.fixed_assets
    (entity_id, name, asset_class, purchase_date, cost)
  values (
    (select id from public.entities where code = 'JAL'),
    'No actor asset', 'IT', '2026-01-01', 5000.00
  )
$$, 'require_actor: fixed_assets INSERT with no auth.uid() and no created_by → rejected (Iron Law 3)');

select test.expect_fail($$
  insert into public.bank_feed
    (entity_id, account_code, statement_date, statement_balance)
  values (
    (select id from public.entities where code = 'JAL'),
    '1110', '2026-01-31', 100.00
  )
$$, 'require_actor: bank_feed INSERT with no auth.uid() and no created_by → rejected (Iron Law 3)');

-- ============================================================================
-- CLEANUP
-- ============================================================================

reset role;

delete from public.fixed_assets where id in (
  'd0000001-0000-0000-0000-000000000000',
  'd0000002-0000-0000-0000-000000000000'
);

delete from public.bank_feed where id in (
  'd0000003-0000-0000-0000-000000000000',
  'd0000004-0000-0000-0000-000000000000'
);

reset role;
select '======== ALL P1-T7 TESTS PASSED ========' as result;
