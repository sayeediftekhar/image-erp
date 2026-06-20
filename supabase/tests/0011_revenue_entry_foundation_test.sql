-- ============================================================================
-- P2-T1 TEST SUITE: revenue_day + daily_activity foundation
-- Run order: shim → 0001–0011 → 0001_test → … → 0010_test → THIS FILE
-- Proves:
--   A. Setup: JAL + NAS rows seeded as superuser for cross-entity RLS tests.
--   B. Schema constraints: status CHECK; unique constraint on revenue_day;
--      unique constraint on daily_activity.
--   C. READ scoping: ENTRY entity-scoped; ADMIN / HQ_FINANCE / READ_ONLY see all.
--   D. ENTRY write on revenue_day: own DRAFT → allowed; wrong entity, wrong
--      status, NAS row updates → blocked.
--   E. daily_activity no authenticated write: INSERT/UPDATE → permission denied
--      (privilege-layer denial, not RLS silent — expect_fail for both).
--   F. require_actor: null-actor INSERT rejected on both tables (Iron Law 3).
--   G. Audit: audit_log row written on INSERT.
--   H. Touch: updated_at stamped after UPDATE.
--   I. Direction guard: SUBMITTED→DRAFT rejected (trigger); DRAFT→SUBMITTED
--      and non-status updates on SUBMITTED rows are unblocked.
--   J. Cleanup.
--
-- UUID prefix 'f' — avoids collision with prior test files ('a'–'e').
--   f0000001-... = JAL revenue_day 2026-02-01 DRAFT  (setup)
--   f0000002-... = NAS revenue_day 2026-02-01 DRAFT  (setup)
--   f0000003-... = JAL daily_activity 2026-02-01 MORNING/OUTDOOR/patients_new (setup)
--   f0000004-... = NAS daily_activity 2026-02-01 MORNING/OUTDOOR/patients_new (setup)
--   f0000005-... = JAL revenue_day 2026-02-15 SUBMITTED (direction guard test)
--
-- Pre-existing app users (left by 0001_dimension_schema_test.sql):
--   11111111-... = ADMIN          22222222-... = HQ_FINANCE
--   33333333-... = ENTRY (JAL)    44444444-... = READ_ONLY
-- ============================================================================
\set ON_ERROR_STOP on

-- ============================================================================
-- A. SETUP — JAL + NAS rows inserted as superuser (bypasses RLS; created_by
--    explicit so require_actor passes).
-- ============================================================================

reset role;

insert into public.revenue_day
  (id, entity_id, revenue_date, status, draft_data, created_by)
values
  (
    'f0000001-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    '2026-02-01', 'DRAFT', '{"notes":"morning session"}',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'f0000002-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'NAS'),
    '2026-02-01', 'DRAFT', '{}',
    '11111111-1111-1111-1111-111111111111'
  );

insert into public.daily_activity
  (id, entity_id, activity_date, channel, service, metric, value, created_by)
values
  (
    'f0000003-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    '2026-02-01', 'MORNING', 'OUTDOOR', 'patients_new', 10,
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'f0000004-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'NAS'),
    '2026-02-01', 'MORNING', 'OUTDOOR', 'patients_new', 5,
    '11111111-1111-1111-1111-111111111111'
  );

select test.assert(
  (select count(*)::int from public.revenue_day
    where id in (
      'f0000001-0000-0000-0000-000000000000',
      'f0000002-0000-0000-0000-000000000000')) = 2,
  'setup: JAL + NAS revenue_day rows committed'
);
select test.assert(
  (select count(*)::int from public.daily_activity
    where id in (
      'f0000003-0000-0000-0000-000000000000',
      'f0000004-0000-0000-0000-000000000000')) = 2,
  'setup: JAL + NAS daily_activity rows committed'
);

-- ============================================================================
-- B. SCHEMA CONSTRAINTS
-- ============================================================================

-- B1: status CHECK rejects any value outside ('DRAFT','SUBMITTED')
select test.expect_fail($$
  insert into public.revenue_day
    (entity_id, revenue_date, status, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-03-01', 'VOID', '11111111-1111-1111-1111-111111111111'
  )
$$, 'revenue_day: status CHECK rejects invalid value VOID');

-- B2: unique constraint on (entity_id, revenue_date) — f0000001 is JAL + 2026-02-01
select test.expect_fail($$
  insert into public.revenue_day
    (entity_id, revenue_date, status, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-02-01', 'DRAFT', '11111111-1111-1111-1111-111111111111'
  )
$$, 'revenue_day: unique (entity_id, revenue_date) blocks duplicate');

-- B3: unique constraint on (entity_id, activity_date, channel, service, metric)
select test.expect_fail($$
  insert into public.daily_activity
    (entity_id, activity_date, channel, service, metric, value, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-02-01', 'MORNING', 'OUTDOOR', 'patients_new', 99,
    '11111111-1111-1111-1111-111111111111'
  )
$$, 'daily_activity: unique (entity_id, date, channel, service, metric) blocks duplicate cell');

-- ============================================================================
-- C. READ SCOPING
-- At this point: 2 revenue_day rows (f0000001 JAL, f0000002 NAS),
--               2 daily_activity rows (f0000003 JAL, f0000004 NAS).
-- ============================================================================

set role authenticated;

-- ADMIN sees all revenue_day rows
select auth.login_as('11111111-1111-1111-1111-111111111111');
select test.assert(
  (select count(*)::int from public.revenue_day
    where id in (
      'f0000001-0000-0000-0000-000000000000',
      'f0000002-0000-0000-0000-000000000000')) = 2,
  'C: ADMIN sees both revenue_day rows (JAL + NAS)'
);
select test.assert(
  (select count(*)::int from public.daily_activity
    where id in (
      'f0000003-0000-0000-0000-000000000000',
      'f0000004-0000-0000-0000-000000000000')) = 2,
  'C: ADMIN sees both daily_activity rows (JAL + NAS)'
);

-- HQ_FINANCE sees all
select auth.login_as('22222222-2222-2222-2222-222222222222');
select test.assert(
  (select count(*)::int from public.revenue_day
    where id in (
      'f0000001-0000-0000-0000-000000000000',
      'f0000002-0000-0000-0000-000000000000')) = 2,
  'C: HQ_FINANCE sees both revenue_day rows'
);
select test.assert(
  (select count(*)::int from public.daily_activity
    where id in (
      'f0000003-0000-0000-0000-000000000000',
      'f0000004-0000-0000-0000-000000000000')) = 2,
  'C: HQ_FINANCE sees both daily_activity rows'
);

-- READ_ONLY sees all
select auth.login_as('44444444-4444-4444-4444-444444444444');
select test.assert(
  (select count(*)::int from public.revenue_day
    where id in (
      'f0000001-0000-0000-0000-000000000000',
      'f0000002-0000-0000-0000-000000000000')) = 2,
  'C: READ_ONLY sees both revenue_day rows'
);
select test.assert(
  (select count(*)::int from public.daily_activity
    where id in (
      'f0000003-0000-0000-0000-000000000000',
      'f0000004-0000-0000-0000-000000000000')) = 2,
  'C: READ_ONLY sees both daily_activity rows'
);

-- ENTRY (JAL) sees only their own entity
select auth.login_as('33333333-3333-3333-3333-333333333333');
select test.assert(
  exists (select 1 from public.revenue_day
    where id = 'f0000001-0000-0000-0000-000000000000'),
  'C: ENTRY (JAL) can see their own revenue_day row (f0000001 JAL)'
);
select test.assert(
  not exists (select 1 from public.revenue_day
    where id = 'f0000002-0000-0000-0000-000000000000'),
  'C: ENTRY (JAL) cannot see NAS revenue_day row (entity-scoped RLS)'
);
select test.assert(
  exists (select 1 from public.daily_activity
    where id = 'f0000003-0000-0000-0000-000000000000'),
  'C: ENTRY (JAL) can see their own daily_activity row (f0000003 JAL)'
);
select test.assert(
  not exists (select 1 from public.daily_activity
    where id = 'f0000004-0000-0000-0000-000000000000'),
  'C: ENTRY (JAL) cannot see NAS daily_activity row (entity-scoped RLS)'
);

-- ============================================================================
-- D. ENTRY WRITE — revenue_day
-- ============================================================================

reset role;
select auth.login_as('33333333-3333-3333-3333-333333333333');
set role authenticated;

-- D1: ENTRY can INSERT a DRAFT revenue_day for their own entity
insert into public.revenue_day (entity_id, revenue_date, draft_data)
values (
  (select id from public.entities where code = 'JAL'),
  '2026-02-03',
  '{"step":"outdoor","morning_service_charge":5000}'
);

select test.assert(
  exists (
    select 1 from public.revenue_day
    where entity_id = (select id from public.entities where code = 'JAL')
      and revenue_date = '2026-02-03'
      and status = 'DRAFT'
  ),
  'D1: ENTRY can INSERT a DRAFT revenue_day for own entity (JAL)'
);
select test.assert(
  (select created_by from public.revenue_day
    where entity_id = (select id from public.entities where code = 'JAL')
      and revenue_date = '2026-02-03')
  = '33333333-3333-3333-3333-333333333333',
  'D1: created_by is set to the ENTRY user (auth.uid())'
);

-- D2: ENTRY can UPDATE draft_data on their own DRAFT
update public.revenue_day
  set draft_data = '{"step":"usg","morning_service_charge":5000,"usg_lower_count":2}'
  where entity_id = (select id from public.entities where code = 'JAL')
    and revenue_date = '2026-02-03';

select test.assert(
  (select draft_data->>'step' from public.revenue_day
    where entity_id = (select id from public.entities where code = 'JAL')
      and revenue_date = '2026-02-03') = 'usg',
  'D2: ENTRY can UPDATE draft_data on own DRAFT revenue_day'
);

-- D3: ENTRY cannot INSERT a revenue_day for a different entity (NAS)
select test.expect_fail($$
  insert into public.revenue_day (entity_id, revenue_date, draft_data)
  values (
    (select id from public.entities where code = 'NAS'),
    '2026-02-10',
    '{}'
  )
$$, 'D3: ENTRY cannot INSERT revenue_day for wrong entity (NAS) — RLS WITH CHECK violation');

-- D4: ENTRY cannot INSERT with status = 'SUBMITTED' (must be DRAFT)
select test.expect_fail($$
  insert into public.revenue_day (entity_id, revenue_date, status, draft_data)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-02-10',
    'SUBMITTED',
    '{}'
  )
$$, 'D4: ENTRY cannot INSERT revenue_day with status=SUBMITTED — RLS WITH CHECK violation');

-- D5: ENTRY cannot UPDATE status to SUBMITTED on own DRAFT
-- (USING passes — row is their own DRAFT; WITH CHECK fails — new.status != DRAFT)
select test.expect_fail($$
  update public.revenue_day
    set status = 'SUBMITTED'
    where entity_id = (select id from public.entities where code = 'JAL')
      and revenue_date = '2026-02-03'
$$, 'D5: ENTRY cannot flip status to SUBMITTED via authenticated path — RLS WITH CHECK violation');

select test.assert(
  (select status from public.revenue_day
    where entity_id = (select id from public.entities where code = 'JAL')
      and revenue_date = '2026-02-03') = 'DRAFT',
  'D5: status is still DRAFT after rejected flip attempt'
);

-- D6: ENTRY UPDATE on a different entity's revenue_day → 0 rows, no error
-- (USING: entity_id = NAS ≠ app.current_entity() = JAL → row invisible for UPDATE)
update public.revenue_day
  set draft_data = '{"tampered":true}'
  where id = 'f0000002-0000-0000-0000-000000000000';

-- Step out of authenticated to read the NAS row and assert it is unchanged
reset role;
select test.assert(
  (select draft_data::text from public.revenue_day
    where id = 'f0000002-0000-0000-0000-000000000000') = '{}',
  'D6: ENTRY UPDATE on NAS revenue_day silently affects 0 rows — row unchanged'
);

-- ============================================================================
-- E. DAILY_ACTIVITY — NO AUTHENTICATED WRITE
-- Grant is SELECT-only → privilege-layer denial (permission denied), not a
-- silent 0-row result. Use expect_fail (same pattern as journal_lines in T4).
-- ============================================================================

reset role;
select auth.login_as('33333333-3333-3333-3333-333333333333');
set role authenticated;

select test.expect_fail($$
  insert into public.daily_activity
    (entity_id, activity_date, channel, service, metric, value)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-02-03', 'MORNING', 'OUTDOOR', 'services', 50
  )
$$, 'E: ENTRY cannot INSERT into daily_activity (no write grant — permission denied)');

-- ADMIN via authenticated is also blocked (no INSERT grant on daily_activity for anyone)
select auth.login_as('11111111-1111-1111-1111-111111111111');

select test.expect_fail($$
  insert into public.daily_activity
    (entity_id, activity_date, channel, service, metric, value)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-02-03', 'MORNING', 'OUTDOOR', 'services', 50
  )
$$, 'E: ADMIN (authenticated) cannot INSERT into daily_activity (no write grant)');

select test.expect_fail($$
  update public.daily_activity
    set value = 999
    where id = 'f0000003-0000-0000-0000-000000000000'
$$, 'E: ADMIN (authenticated) cannot UPDATE daily_activity (no write grant)');

-- ============================================================================
-- F. REQUIRE_ACTOR (Iron Law 3)
-- Run as superuser (bypasses RLS/grants); trigger fires regardless.
-- Omit created_by → defaults to auth.uid() = null (after logout).
-- ============================================================================

reset role;
select auth.logout();

select test.expect_fail($$
  insert into public.revenue_day (entity_id, revenue_date, status)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-02-20', 'DRAFT'
  )
$$, 'F: null-actor INSERT into revenue_day rejected (require_actor / Iron Law 3)');

select test.expect_fail($$
  insert into public.daily_activity (entity_id, activity_date, channel, service, metric, value)
  values (
    (select id from public.entities where code = 'JAL'),
    '2026-02-20', 'MORNING', 'OUTDOOR', 'patients_new', 5
  )
$$, 'F: null-actor INSERT into daily_activity rejected (require_actor / Iron Law 3)');

-- ============================================================================
-- G. AUDIT (Iron Law 3)
-- audit_log row must appear for INSERTs on both tables.
-- f0000001 (revenue_day) and f0000003 (daily_activity) were inserted in setup.
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'revenue_day'
      and op = 'INSERT'
      and record_id = 'f0000001-0000-0000-0000-000000000000'
      and old_json is null
      and new_json->>'id' = 'f0000001-0000-0000-0000-000000000000'
  ),
  'G: audit_log row written for revenue_day INSERT (f0000001)'
);

select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'daily_activity'
      and op = 'INSERT'
      and record_id = 'f0000003-0000-0000-0000-000000000000'
      and old_json is null
      and new_json->>'id' = 'f0000003-0000-0000-0000-000000000000'
  ),
  'G: audit_log row written for daily_activity INSERT (f0000003)'
);

-- ============================================================================
-- H. TOUCH — updated_at stamped after UPDATE
-- The ENTRY UPDATE in D2 already updated the JAL 2026-02-03 row.
-- ============================================================================

reset role;

select test.assert(
  (select updated_at from public.revenue_day
    where entity_id = (select id from public.entities where code = 'JAL')
      and revenue_date = '2026-02-03') is not null,
  'H: updated_at is stamped after UPDATE (touch_updated trigger)'
);
select test.assert(
  (select updated_by from public.revenue_day
    where entity_id = (select id from public.entities where code = 'JAL')
      and revenue_date = '2026-02-03')
  = '33333333-3333-3333-3333-333333333333',
  'H: updated_by is set to the ENTRY user who performed the UPDATE'
);

-- ============================================================================
-- I. DIRECTION GUARD — SUBMITTED is a terminal status
-- ============================================================================

reset role;

-- I1: Superuser can INSERT a SUBMITTED revenue_day (service_role equivalent);
--     status CHECK allows it; no direction guard on INSERT (only on UPDATE).
insert into public.revenue_day
  (id, entity_id, revenue_date, status, draft_data, submitted_at, created_by)
values (
  'f0000005-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'JAL'),
  '2026-02-15', 'SUBMITTED', '{"step":"done"}', now(),
  '11111111-1111-1111-1111-111111111111'
);

select test.assert(
  (select status from public.revenue_day
    where id = 'f0000005-0000-0000-0000-000000000000') = 'SUBMITTED',
  'I1: SUBMITTED revenue_day row inserted successfully (superuser / service_role path)'
);

-- I2: UPDATE SUBMITTED → DRAFT is blocked by the direction guard trigger
select test.expect_fail($$
  update public.revenue_day
    set status = 'DRAFT'
    where id = 'f0000005-0000-0000-0000-000000000000'
$$, 'I2: SUBMITTED → DRAFT reversion blocked by direction guard trigger');

select test.assert(
  (select status from public.revenue_day
    where id = 'f0000005-0000-0000-0000-000000000000') = 'SUBMITTED',
  'I2: status remains SUBMITTED after rejected reversion attempt'
);

-- I3: UPDATE of a non-status field on SUBMITTED row is allowed
--     (old.status='SUBMITTED', new.status='SUBMITTED' → guard condition false)
update public.revenue_day
  set draft_data = '{"step":"done","corrected":true}'
  where id = 'f0000005-0000-0000-0000-000000000000';

select test.assert(
  (select draft_data->>'corrected' from public.revenue_day
    where id = 'f0000005-0000-0000-0000-000000000000') = 'true',
  'I3: non-status field update on SUBMITTED row is allowed (direction guard does not block it)'
);

-- I4: DRAFT → SUBMITTED transition is NOT blocked by the guard
--     (old.status='DRAFT' → guard condition false → trigger does nothing)
update public.revenue_day
  set status = 'SUBMITTED', submitted_at = now()
  where entity_id = (select id from public.entities where code = 'JAL')
    and revenue_date = '2026-02-03';

select test.assert(
  (select status from public.revenue_day
    where entity_id = (select id from public.entities where code = 'JAL')
      and revenue_date = '2026-02-03') = 'SUBMITTED',
  'I4: DRAFT → SUBMITTED transition is not blocked by the direction guard'
);

-- ============================================================================
-- J. CLEANUP
-- ============================================================================

reset role;

delete from public.revenue_day
  where id in (
    'f0000001-0000-0000-0000-000000000000',
    'f0000002-0000-0000-0000-000000000000',
    'f0000005-0000-0000-0000-000000000000'
  );

delete from public.revenue_day
  where entity_id = (select id from public.entities where code = 'JAL')
    and revenue_date = '2026-02-03';

-- daily_activity: f0000003 and f0000004 were inserted as superuser; cascade
-- delete via revenue_day would not reach them (revenue_day_id is null).
delete from public.daily_activity
  where id in (
    'f0000003-0000-0000-0000-000000000000',
    'f0000004-0000-0000-0000-000000000000'
  );

reset role;
select '======== ALL P2-T1 TESTS PASSED ========' as result;
