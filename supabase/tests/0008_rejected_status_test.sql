-- ============================================================================
-- P1-T5e TEST SUITE: REJECTED status + rejection_reason
-- Run order: shim → 0001–0008 → 0001_test → … → 0007_test → THIS FILE
-- Proves:
--   1. status='REJECTED' accepted by widened CHECK; invalid status still fails
--   2. rejection_reason column exists and is nullable
--   3. REJECTED entry blocks UPDATE (terminal, no onward transition)
--   4. REJECTED entry blocks DELETE (audit-first permanent record)
--   5. Lines of a REJECTED entry block UPDATE and DELETE
--   6. POSTED→REVERSED regression: sole POSTED exception still works
--   7. PENDING_APPROVAL freely mutable: regression on T4b behaviour
--
-- Pre-specified entry UUIDs (prefix 'c' to avoid collision with 0005 'b' series):
--   c0000001-... = JAL entry that will be set to REJECTED
--   c0000002-... = JAL entry for POSTED→REVERSED regression
--   c0000003-... = JAL entry for PENDING_APPROVAL regression
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

-- ============================================================================
-- SETUP — three entries with balanced lines
-- ============================================================================

BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'c0000001-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'Rejected entry (T5e test)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('c0000001-0000-0000-0000-000000000000', '2010', 'RDF', 1000.00, 0.00,
     '11111111-1111-1111-1111-111111111111'),
    ('c0000001-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 1000.00,
     '11111111-1111-1111-1111-111111111111');
COMMIT;

BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'c0000002-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'Posted/reversed entry (T5e regression)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('c0000002-0000-0000-0000-000000000000', '2010', 'RDF', 500.00, 0.00,
     '11111111-1111-1111-1111-111111111111'),
    ('c0000002-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 500.00,
     '11111111-1111-1111-1111-111111111111');
COMMIT;

BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'c0000003-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'PA entry (T5e regression)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('c0000003-0000-0000-0000-000000000000', '2010', 'RDF', 200.00, 0.00,
     '11111111-1111-1111-1111-111111111111'),
    ('c0000003-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 200.00,
     '11111111-1111-1111-1111-111111111111');
COMMIT;

-- ============================================================================
-- CRITERION 1a — status='REJECTED' accepted by the widened CHECK
-- PENDING_APPROVAL is freely mutable (T4b), so this UPDATE is allowed by the
-- trigger; the CHECK now permits 'REJECTED'.
-- ============================================================================

update public.journal_entries
  set status = 'PENDING_APPROVAL'
  where id = 'c0000001-0000-0000-0000-000000000000';

-- rejectEntry-like UPDATE: PENDING_APPROVAL → REJECTED with rejection_reason
update public.journal_entries
  set status = 'REJECTED', rejection_reason = 'duplicate expense claim'
  where id = 'c0000001-0000-0000-0000-000000000000';

select test.assert(
  (select status from public.journal_entries
    where id = 'c0000001-0000-0000-0000-000000000000') = 'REJECTED',
  'status=REJECTED accepted by widened CHECK constraint'
);

-- ============================================================================
-- CRITERION 1b — invalid status still rejected by CHECK
-- ============================================================================

select test.expect_fail($$
  update public.journal_entries
    set status = 'BOGUS'
    where id = 'c0000003-0000-0000-0000-000000000000'
$$, 'invalid status still violates CHECK constraint after widening');

-- ============================================================================
-- CRITERION 2 — rejection_reason column exists and is nullable
-- ============================================================================

select test.assert(
  (select rejection_reason from public.journal_entries
    where id = 'c0000001-0000-0000-0000-000000000000') = 'duplicate expense claim',
  'rejection_reason stored correctly (non-null case)'
);

select test.assert(
  (select rejection_reason from public.journal_entries
    where id = 'c0000002-0000-0000-0000-000000000000') is null,
  'rejection_reason is null on non-rejected entry (nullable column)'
);

-- ============================================================================
-- CRITERION 3 — REJECTED entry blocks UPDATE (terminal, no onward transition)
-- ============================================================================

select test.expect_fail($$
  update public.journal_entries
    set description = 'tampered'
    where id = 'c0000001-0000-0000-0000-000000000000'
$$, 'UPDATE on REJECTED entry blocked (field change rejected)');

select test.expect_fail($$
  update public.journal_entries
    set status = 'DRAFT'
    where id = 'c0000001-0000-0000-0000-000000000000'
$$, 'REJECTED→DRAFT transition blocked (REJECTED is terminal, no onward transition)');

select test.expect_fail($$
  update public.journal_entries
    set status = 'PENDING_APPROVAL'
    where id = 'c0000001-0000-0000-0000-000000000000'
$$, 'REJECTED→PENDING_APPROVAL transition blocked');

-- ============================================================================
-- CRITERION 4 — REJECTED entry blocks DELETE (audit-first)
-- ============================================================================

select test.expect_fail($$
  delete from public.journal_entries
    where id = 'c0000001-0000-0000-0000-000000000000'
$$, 'DELETE of REJECTED entry blocked (Iron Law 3: permanent record)');

-- ============================================================================
-- CRITERION 5 — Lines of a REJECTED entry block UPDATE and DELETE
-- ============================================================================

select test.expect_fail($$
  update public.journal_lines
    set debit = 9999
    where entry_id = 'c0000001-0000-0000-0000-000000000000'
$$, 'UPDATE on line of REJECTED entry blocked');

select test.expect_fail($$
  delete from public.journal_lines
    where entry_id = 'c0000001-0000-0000-0000-000000000000'
$$, 'DELETE of line of REJECTED entry blocked');

-- ============================================================================
-- CRITERION 6 — POSTED→REVERSED regression: sole POSTED exception still works;
--               POSTED→REJECTED is still blocked (POSTED only allows →REVERSED)
-- ============================================================================

update public.journal_entries
  set status = 'POSTED'
  where id = 'c0000002-0000-0000-0000-000000000000';

select test.assert(
  (select status from public.journal_entries
    where id = 'c0000002-0000-0000-0000-000000000000') = 'POSTED',
  'regression setup: c0000002 promoted to POSTED'
);

-- POSTED→REJECTED must fail: POSTED only permits the single POSTED→REVERSED exception.
-- Test this while c0000002 is still POSTED (before the POSTED→REVERSED flip below).
select test.expect_fail($$
  update public.journal_entries
    set status = 'REJECTED'
    where id = 'c0000002-0000-0000-0000-000000000000'
$$, 'POSTED→REJECTED blocked (POSTED only allows →REVERSED; 0008 did not add a second exception)');

select test.expect_ok($$
  update public.journal_entries
    set status = 'REVERSED'
    where id = 'c0000002-0000-0000-0000-000000000000'
$$, 'POSTED→REVERSED still allowed after 0008 (POSTED logic unchanged)');

select test.assert(
  (select status from public.journal_entries
    where id = 'c0000002-0000-0000-0000-000000000000') = 'REVERSED',
  'entry is REVERSED after the allowed POSTED→REVERSED transition'
);

-- ============================================================================
-- CRITERION 7 — PENDING_APPROVAL freely mutable (T4b regression)
-- ============================================================================

update public.journal_entries
  set status = 'PENDING_APPROVAL'
  where id = 'c0000003-0000-0000-0000-000000000000';

select test.expect_ok($$
  update public.journal_entries
    set description = 'edited while pending'
    where id = 'c0000003-0000-0000-0000-000000000000'
$$, 'PENDING_APPROVAL entry freely mutable (T4b regression)');

-- ============================================================================
-- CLEANUP
-- c0000001 = REJECTED (terminal — cannot DELETE; disable trigger to clean up)
-- c0000002 = REVERSED (not POSTED; can DELETE; cascade clears lines)
-- c0000003 = PENDING_APPROVAL (not POSTED; can DELETE; cascade clears lines)
-- ============================================================================

alter table public.journal_entries disable trigger trg_journal_entries_immutable;
alter table public.journal_lines   disable trigger trg_journal_lines_immutable;
delete from public.journal_entries where id in (
  'c0000001-0000-0000-0000-000000000000',
  'c0000002-0000-0000-0000-000000000000',
  'c0000003-0000-0000-0000-000000000000'
);
alter table public.journal_lines   enable trigger trg_journal_lines_immutable;
alter table public.journal_entries enable trigger trg_journal_entries_immutable;

reset role;
select '======== ALL P1-T5e MIGRATION TESTS PASSED ========' as result;
