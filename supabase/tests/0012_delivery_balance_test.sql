-- ============================================================================
-- P2-T2 TEST SUITE: delivery_balance (migration 0012)
-- Run order: shim → 0001–0012 → 0001_test → … → 0011_test → THIS FILE
-- Proves:
--   A. Table exists; delivery_type CHECK; status CHECK
--   B. require_actor guard blocks null-actor INSERT
--   C. ENTRY (JAL) can INSERT for own entity
--   D. ENTRY (JAL) blocked from INSERT for NAS entity (entity-scope RLS)
--   E. ENTRY (JAL) sees only own-entity rows (SELECT scope)
--   F. ADMIN sees all rows (READ-ALL)
--   G. touch trigger stamps updated_at on UPDATE
--   H. Audit trigger writes audit.log on INSERT and UPDATE
--   I. revenue_day_id FK and status defaulted correctly
--
-- UUID prefix 'f1' — avoids collision with prior test files ('a'–'f0'; hex only goes to f).
--   f1000001-... = JAL revenue_day (test anchor)
--   f1000002-... = NAS revenue_day (cross-entity scope test)
--   f1000003-... = JAL delivery_balance (CSECTION)
--   f1000004-... = NAS delivery_balance (SAFE, inserted as ADMIN)
-- ============================================================================
\set ON_ERROR_STOP on

-- ============================================================================
-- SETUP — insert revenue_day anchors (as superuser; require_actor uses uid or explicit)
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

insert into public.revenue_day
  (id, entity_id, revenue_date, status, created_by)
values
  (
    'f1000001-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    '2026-03-01', 'DRAFT',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'f1000002-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'NAS'),
    '2026-03-01', 'DRAFT',
    '11111111-1111-1111-1111-111111111111'
  );

-- ============================================================================
-- CRITERION A — delivery_type and status CHECK constraints
-- ============================================================================

select test.expect_fail($$
  insert into public.delivery_balance
    (entity_id, patient_name, delivery_type, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    'Test Patient', 'NORMAL',
    '11111111-1111-1111-1111-111111111111'
  )
$$, '0012: delivery_type ''NORMAL'' rejected by CHECK (only CSECTION/SAFE)');

select test.expect_fail($$
  insert into public.delivery_balance
    (entity_id, patient_name, delivery_type, status, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    'Test Patient', 'CSECTION', 'PENDING',
    '11111111-1111-1111-1111-111111111111'
  )
$$, '0012: status ''PENDING'' rejected by CHECK (only OPEN/CLOSED)');

-- ============================================================================
-- CRITERION B — require_actor: null actor (no auth.uid(), no explicit created_by)
-- ============================================================================

reset role;
select auth.logout();

select test.expect_fail($$
  insert into public.delivery_balance
    (entity_id, patient_name, delivery_type)
  values (
    (select id from public.entities where code = 'JAL'),
    'Null actor test', 'CSECTION'
  )
$$, '0012: null-actor INSERT rejected (Iron Law 3 — require_actor)');

-- ============================================================================
-- CRITERION C — ENTRY (JAL) can INSERT for own entity
-- ============================================================================

reset role;
select auth.login_as('33333333-3333-3333-3333-333333333333');
set role authenticated;

insert into public.delivery_balance
  (id, entity_id, revenue_day_id, patient_name, delivery_type, advance_paid, expected_balance, expected_date)
values (
  'f1000003-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'JAL'),
  'f1000001-0000-0000-0000-000000000000',
  'Fatema Begum', 'CSECTION', 2000.00, 3000.00, '2026-03-15'
);

select test.assert(
  (select patient_name from public.delivery_balance
    where id = 'f1000003-0000-0000-0000-000000000000') = 'Fatema Begum',
  '0012: ENTRY (JAL) can INSERT delivery_balance for own entity'
);

select test.assert(
  (select status from public.delivery_balance
    where id = 'f1000003-0000-0000-0000-000000000000') = 'OPEN',
  '0012: status defaults to OPEN'
);

select test.assert(
  (select delivery_type from public.delivery_balance
    where id = 'f1000003-0000-0000-0000-000000000000') = 'CSECTION',
  '0012: delivery_type stored correctly'
);

-- ============================================================================
-- CRITERION D — ENTRY (JAL) blocked from INSERT for NAS entity
-- ============================================================================

select test.expect_fail($$
  insert into public.delivery_balance
    (entity_id, patient_name, delivery_type)
  values (
    (select id from public.entities where code = 'NAS'),
    'Cross-entity attacker', 'SAFE'
  )
$$, '0012: ENTRY (JAL) blocked from INSERT for NAS entity (RLS WITH CHECK)');

-- ============================================================================
-- CRITERION E — ENTRY (JAL) sees only own-entity rows (SELECT scope)
-- ============================================================================

-- ADMIN inserts NAS row so both entities have data
reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');
set role authenticated;

insert into public.delivery_balance
  (id, entity_id, revenue_day_id, patient_name, delivery_type, advance_paid, expected_balance)
values (
  'f1000004-0000-0000-0000-000000000000',
  (select id from public.entities where code = 'NAS'),
  'f1000002-0000-0000-0000-000000000000',
  'Salma Khatun', 'SAFE', 1500.00, 2500.00
);

reset role;
select auth.login_as('33333333-3333-3333-3333-333333333333');
set role authenticated;

select test.assert(
  (select count(*)::int from public.delivery_balance
    where id in (
      'f1000003-0000-0000-0000-000000000000',
      'f1000004-0000-0000-0000-000000000000'
    )) = 1,
  '0012: ENTRY (JAL) sees only 1 row — own entity only (NAS row invisible)'
);

select test.assert(
  (select entity_id from public.delivery_balance
    where id = 'f1000003-0000-0000-0000-000000000000')
  = (select id from public.entities where code = 'JAL'),
  '0012: the 1 visible row belongs to JAL'
);

-- ============================================================================
-- CRITERION F — ADMIN sees all rows (READ-ALL)
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');
set role authenticated;

select test.assert(
  (select count(*)::int from public.delivery_balance
    where id in (
      'f1000003-0000-0000-0000-000000000000',
      'f1000004-0000-0000-0000-000000000000'
    )) = 2,
  '0012: ADMIN sees both JAL and NAS delivery_balance rows (read-all)'
);

-- ============================================================================
-- CRITERION G — touch trigger stamps updated_at on UPDATE
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');
set role authenticated;

update public.delivery_balance
  set status = 'CLOSED', closed_date = '2026-03-16'
  where id = 'f1000003-0000-0000-0000-000000000000';

select test.assert(
  (select updated_at from public.delivery_balance
    where id = 'f1000003-0000-0000-0000-000000000000') is not null,
  '0012: touch trigger stamps updated_at on UPDATE'
);

select test.assert(
  (select status from public.delivery_balance
    where id = 'f1000003-0000-0000-0000-000000000000') = 'CLOSED',
  '0012: status updated to CLOSED successfully'
);

-- ============================================================================
-- CRITERION H — audit trigger writes to audit.log on INSERT and UPDATE
-- ============================================================================

reset role;

select test.assert(
  (select count(*)::int from audit.audit_log
    where table_name = 'delivery_balance'
      and record_id = 'f1000003-0000-0000-0000-000000000000') >= 2,
  '0012: audit.audit_log has ≥2 rows for f1000003 (INSERT + UPDATE)'
);

-- ============================================================================
-- CRITERION I — revenue_day_id FK: integrity enforced
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

select test.expect_fail($$
  insert into public.delivery_balance
    (entity_id, patient_name, delivery_type, revenue_day_id, created_by)
  values (
    (select id from public.entities where code = 'JAL'),
    'Orphan balance', 'CSECTION',
    '00000000-0000-0000-0000-000000000099',
    '11111111-1111-1111-1111-111111111111'
  )
$$, '0012: revenue_day_id FK rejects non-existent revenue_day');

-- ============================================================================
-- CLEANUP
-- ============================================================================

reset role;

delete from public.delivery_balance where id in (
  'f1000003-0000-0000-0000-000000000000',
  'f1000004-0000-0000-0000-000000000000'
);

delete from public.revenue_day where id in (
  'f1000001-0000-0000-0000-000000000000',
  'f1000002-0000-0000-0000-000000000000'
);

reset role;
select '======== ALL P2-T2 DELIVERY_BALANCE TESTS PASSED ========' as result;
