-- ============================================================================
-- P1-T8c TEST SUITE: fixed_assets write policy (migration 0010)
-- Run order: shim → 0001–0010 → 0001_test → … → 0009_test → THIS FILE
-- Proves:
--   1. ADMIN can INSERT a fixed_asset via the new write policy
--   2. accumulated_depreciation still defaults 0 on ADMIN insert (never sent)
--   3. ENTRY role blocked from INSERT (RLS policy enforces app.is_admin())
--   4. ADMIN can UPDATE editable fields (name, cost, active)
--   5. accumulated_depreciation unchanged after UPDATE (UI never sends it)
--   6. ENTRY role blocked from UPDATE
--   7. SELECT entity-scope regression: ENTRY still sees only their entity
--
-- UUID prefix 'e' — avoids collision with 0009 test ('d' prefix).
--   e0000001-... = JAL test asset (inserted as ADMIN)
--   e0000002-... = NAS test asset (for SELECT scope regression)
-- ============================================================================
\set ON_ERROR_STOP on

-- ============================================================================
-- CRITERION 1 — ADMIN can INSERT a fixed_asset via authenticated write policy
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');
set role authenticated;

insert into public.fixed_assets
  (id, entity_id, name, asset_class, purchase_date, cost)
values (
  'e0000001-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'JAL'),
  'T8c test asset', 'IT', '2026-01-01', 45000.00
);

select test.assert(
  (select name from public.fixed_assets
    where id = 'e0000001-0000-0000-0000-000000000000') = 'T8c test asset',
  '0010: ADMIN can INSERT a fixed_asset via authenticated write policy'
);

-- ============================================================================
-- CRITERION 2 — accumulated_depreciation defaults 0; never sent by the UI
-- ============================================================================

select test.assert(
  (select accumulated_depreciation from public.fixed_assets
    where id = 'e0000001-0000-0000-0000-000000000000') = 0,
  '0010: accumulated_depreciation defaults 0 on ADMIN insert (Iron Law 1 — never hand-entered)'
);

-- ============================================================================
-- CRITERION 3 — ENTRY role blocked from INSERT (RLS still enforces app.is_admin())
-- ============================================================================

reset role;
select auth.login_as('33333333-3333-3333-3333-333333333333');
set role authenticated;

select test.expect_fail($$
  insert into public.fixed_assets
    (entity_id, name, asset_class, purchase_date, cost)
  values (
    (select id from public.entities where code = 'JAL'),
    'ENTRY sneaky insert', 'IT', '2026-01-01', 5000.00
  )
$$, '0010: ENTRY role blocked from INSERT by RLS fixed_assets_write policy');

-- ============================================================================
-- CRITERION 4 — ADMIN can UPDATE editable fields; accumulated_depreciation unchanged
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');
set role authenticated;

update public.fixed_assets
  set name = 'T8c updated asset', cost = 48000.00, active = false
  where id = 'e0000001-0000-0000-0000-000000000000';

select test.assert(
  (select name from public.fixed_assets
    where id = 'e0000001-0000-0000-0000-000000000000') = 'T8c updated asset',
  '0010: ADMIN UPDATE of name succeeds'
);

select test.assert(
  (select cost from public.fixed_assets
    where id = 'e0000001-0000-0000-0000-000000000000') = 48000.00,
  '0010: ADMIN UPDATE of cost succeeds'
);

-- ============================================================================
-- CRITERION 5 — accumulated_depreciation still 0 after UPDATE (UI omits it)
-- ============================================================================

select test.assert(
  (select accumulated_depreciation from public.fixed_assets
    where id = 'e0000001-0000-0000-0000-000000000000') = 0,
  '0010: accumulated_depreciation still 0 after ADMIN UPDATE (never in UPDATE payload)'
);

-- ============================================================================
-- CRITERION 6 — ENTRY role UPDATE silently blocked (0 rows affected, no error)
-- Unlike INSERT (WITH CHECK raises 42501), RLS USING on UPDATE returns 0 rows
-- rather than an error when the target row is invisible to the actor.
-- ============================================================================

reset role;
select auth.login_as('33333333-3333-3333-3333-333333333333');
set role authenticated;

update public.fixed_assets
  set name = 'ENTRY hacked name'
  where id = 'e0000001-0000-0000-0000-000000000000';

reset role;
select test.assert(
  (select name from public.fixed_assets
    where id = 'e0000001-0000-0000-0000-000000000000') = 'T8c updated asset',
  '0010: ENTRY UPDATE silently blocked by RLS — row name unchanged (0 rows affected)'
);

-- ============================================================================
-- CRITERION 7 — SELECT entity-scope regression: ENTRY sees only their entity
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');
set role authenticated;

insert into public.fixed_assets
  (id, entity_id, name, asset_class, purchase_date, cost)
values (
  'e0000002-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'NAS'),
  'T8c NAS scope asset', 'FURNITURE', '2026-02-01', 30000.00
);

reset role;
select auth.login_as('33333333-3333-3333-3333-333333333333');
set role authenticated;

select test.assert(
  (select count(*)::int from public.fixed_assets
    where id in (
      'e0000001-0000-0000-0000-000000000000',
      'e0000002-0000-0000-0000-000000000000'
    )) = 1,
  '0010: SELECT scope regression — ENTRY (JAL) sees only JAL asset, not NAS'
);

select test.assert(
  (select entity_id from public.fixed_assets
    where id = 'e0000001-0000-0000-0000-000000000000')
  = (select id from public.entities where code = 'JAL'),
  '0010: the 1 visible asset belongs to JAL'
);

-- ============================================================================
-- CLEANUP
-- ============================================================================

reset role;

delete from public.fixed_assets where id in (
  'e0000001-0000-0000-0000-000000000000',
  'e0000002-0000-0000-0000-000000000000'
);

reset role;
select '======== ALL P1-T8c WRITE POLICY TESTS PASSED ========' as result;
