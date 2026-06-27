-- ============================================================================
-- P2-T3f-B TEST SUITE: month_gate_override + entities.go_live_month
-- Run order: shim → 0001–0014 → prior tests → THIS FILE
-- Proves:
--   A. Setup: JAL go_live_month set; override rows for JAL+NAS inserted.
--   B. Schema: entities.go_live_month column exists; CHECK constraints; UNIQUE.
--   C. RLS — ADMIN sees all, can write; ENTRY sees own entity only, cannot write.
--   D. Audit: INSERT fires audit.log_change(); op='INSERT' in audit_log.
--   E. Touch: UPDATE stamps updated_at.
--   F. Cleanup.
--
-- UUID prefix 'g' (avoids collision with prior test suites 'a'–'f').
--   g0000001-... = month_gate_override JAL 2026-07 (for RLS + audit tests)
--   g0000002-... = month_gate_override NAS 2026-07 (for ENTRY isolation test)
--
-- Pre-existing app users (from 0001_dimension_schema_test.sql):
--   11111111-... = ADMIN          22222222-... = HQ_FINANCE
--   33333333-... = ENTRY (JAL)    44444444-... = READ_ONLY
-- ============================================================================
\set ON_ERROR_STOP on

-- ============================================================================
-- A. SETUP
-- ============================================================================

reset role;

-- Set go_live_month on JAL (as superuser, bypassing RLS)
update public.entities
  set go_live_month = '2026-07',
      updated_by = '11111111-1111-1111-1111-111111111111'
  where code = 'JAL';

select test.assert(
  (select go_live_month from public.entities where code = 'JAL') = '2026-07',
  'setup: JAL go_live_month set to 2026-07'
);

-- Insert override rows (as superuser; created_by required for require_actor check)
insert into public.month_gate_override
  (id, entity_id, gated_month, granted_by, note, created_by)
values
  (
    'g0000001-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    '2026-08',
    '11111111-1111-1111-1111-111111111111',
    'Testing override for JAL August',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'g0000002-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'NAS'),
    '2026-08',
    '11111111-1111-1111-1111-111111111111',
    null,
    '11111111-1111-1111-1111-111111111111'
  );

select test.assert(
  (select count(*)::int from public.month_gate_override
    where id in (
      'g0000001-0000-0000-0000-000000000000',
      'g0000002-0000-0000-0000-000000000000')) = 2,
  'setup: 2 override rows inserted'
);

-- ============================================================================
-- B. SCHEMA CONSTRAINTS
-- ============================================================================

-- B1: entities.go_live_month accepts valid YYYY-MM
select test.assert(
  (select go_live_month from public.entities where code = 'JAL') = '2026-07',
  'B1: entities.go_live_month column exists and holds YYYY-MM value'
);

-- B2: entities.go_live_month CHECK rejects invalid format
select test.expect_fail($$
  update public.entities
    set go_live_month = '26-7', updated_by = '11111111-1111-1111-1111-111111111111'
    where code = 'JAL'
$$, 'B2: go_live_month CHECK rejects non-YYYY-MM format');

-- B3: entities.go_live_month accepts NULL (gate dormant)
update public.entities
  set go_live_month = null,
      updated_by = '11111111-1111-1111-1111-111111111111'
  where code = 'NAS';

select test.assert(
  (select go_live_month from public.entities where code = 'NAS') is null,
  'B3: entities.go_live_month accepts NULL (gate dormant for NAS)'
);

-- B4: gated_month CHECK rejects invalid format
select test.expect_fail($$
  insert into public.month_gate_override
    (entity_id, gated_month, granted_by, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    '26-08', '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111'
  )
$$, 'B4: gated_month CHECK rejects non-YYYY-MM format');

-- B5: UNIQUE constraint on (entity_id, gated_month) blocks duplicate
select test.expect_fail($$
  insert into public.month_gate_override
    (entity_id, gated_month, granted_by, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-08', '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111'
  )
$$, 'B5: UNIQUE (entity_id, gated_month) blocks duplicate override');

-- ============================================================================
-- C. RLS
-- ============================================================================

set role authenticated;

-- C1: ADMIN sees all override rows
select auth.login_as('11111111-1111-1111-1111-111111111111');
select test.assert(
  (select count(*)::int from public.month_gate_override
    where id in (
      'g0000001-0000-0000-0000-000000000000',
      'g0000002-0000-0000-0000-000000000000')) = 2,
  'C1: ADMIN sees both override rows (JAL + NAS)'
);

-- C2: ADMIN can INSERT an override row (own session)
insert into public.month_gate_override
  (entity_id, gated_month, granted_by, created_by)
values (
  (select id from public.entities where code = 'JAL'),
  '2026-09',
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111'
);
select test.assert(
  (select count(*)::int from public.month_gate_override
    where entity_id = (select id from public.entities where code = 'JAL')) = 2,
  'C2: ADMIN can INSERT a new JAL override'
);

-- C3: ENTRY (JAL, 33333333) sees JAL override only — not NAS
select auth.login_as('33333333-3333-3333-3333-333333333333');
select test.assert(
  (select count(*)::int from public.month_gate_override
    where id = 'g0000001-0000-0000-0000-000000000000') = 1,
  'C3: ENTRY (JAL) can see own entity override'
);
select test.assert(
  (select count(*)::int from public.month_gate_override
    where id = 'g0000002-0000-0000-0000-000000000000') = 0,
  'C3: ENTRY (JAL) cannot see NAS override'
);

-- C4: ENTRY cannot INSERT an override (RLS with-check blocks non-admin)
select test.expect_fail($$
  insert into public.month_gate_override
    (entity_id, gated_month, granted_by, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-10', '33333333-3333-3333-3333-333333333333',
    '33333333-3333-3333-3333-333333333333'
  )
$$, 'C4: ENTRY cannot INSERT override (RLS with-check)');

-- ============================================================================
-- D. AUDIT TRIGGER
-- ============================================================================

reset role;

-- The INSERT in section A (g0000001) should have produced an audit row.
select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'month_gate_override'
      and record_id   = 'g0000001-0000-0000-0000-000000000000'
      and op          = 'INSERT'
  ),
  'D: audit_log has INSERT entry for g0000001 override row'
);

-- ============================================================================
-- E. TOUCH TRIGGER (updated_at stamped on UPDATE)
-- ============================================================================

-- updated_at is null before first update
select test.assert(
  (select updated_at from public.month_gate_override
    where id = 'g0000001-0000-0000-0000-000000000000') is null,
  'E: updated_at is null before first UPDATE'
);

update public.month_gate_override
  set note = 'updated note',
      updated_by = '11111111-1111-1111-1111-111111111111'
  where id = 'g0000001-0000-0000-0000-000000000000';

select test.assert(
  (select updated_at from public.month_gate_override
    where id = 'g0000001-0000-0000-0000-000000000000') is not null,
  'E: updated_at stamped after UPDATE'
);

-- ============================================================================
-- F. CLEANUP
-- ============================================================================

reset role;

delete from public.month_gate_override
  where id in (
    'g0000001-0000-0000-0000-000000000000',
    'g0000002-0000-0000-0000-000000000000'
  )
  or (entity_id = (select id from public.entities where code = 'JAL')
      and gated_month = '2026-09');

-- Reset go_live_month on JAL (leave clean for other test runs)
update public.entities
  set go_live_month = null,
      updated_by = '11111111-1111-1111-1111-111111111111'
  where code = 'JAL';

select test.assert(
  (select count(*)::int from public.month_gate_override) = 0,
  'F: all test override rows cleaned up'
);
