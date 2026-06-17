-- ============================================================================
-- P1-T4b TEST SUITE: Posted-entry immutability
-- Run order: shim → 0001 → 0002 → 0003 → 0004 → 0005 →
--            0001_test → 0002_test → 0003_test → 0004_test → THIS FILE
-- Proves: POSTED entry/lines are immutable; POSTED→REVERSED is the only
-- permitted mutation; DRAFT and PENDING_APPROVAL remain freely editable.
--
-- All writes run as owner with login_as('11111111-...') — standing in for the
-- posting engine. All immutability rejections use expect_fail (BEFORE trigger;
-- raises immediately — no deferred-constraint idiom needed).
--
-- Pre-specified entry UUIDs:
--   b0000001-... = JAL entry that will be promoted to POSTED
--   b0000002-... = JAL entry that stays DRAFT
--   b0000003-... = JAL entry that will be promoted to PENDING_APPROVAL
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

-- ============================================================================
-- SETUP
-- Each entry needs balanced lines in one transaction (deferred balance trigger).
-- Status promotions are plain UPDATE statements (no deferred trigger involved).
-- ============================================================================

BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'b0000001-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'Posted entry (T4b test)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('b0000001-0000-0000-0000-000000000000', '2010', 'RDF', 3000.00, 0.00,
     '11111111-1111-1111-1111-111111111111'),
    ('b0000001-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 3000.00,
     '11111111-1111-1111-1111-111111111111');
COMMIT;

-- Simulate engine promoting to POSTED (DRAFT→POSTED: block trigger sees
-- OLD.status='DRAFT' → guard is false → allows)
update public.journal_entries
  set status = 'POSTED'
  where id = 'b0000001-0000-0000-0000-000000000000';

select test.assert(
  (select status from public.journal_entries
    where id = 'b0000001-0000-0000-0000-000000000000') = 'POSTED',
  'setup: b0000001 promoted to POSTED'
);

BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'b0000002-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'Draft entry (T4b test)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('b0000002-0000-0000-0000-000000000000', '2010', 'RDF', 800.00, 0.00,
     '11111111-1111-1111-1111-111111111111'),
    ('b0000002-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 800.00,
     '11111111-1111-1111-1111-111111111111');
COMMIT;

BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'b0000003-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'Pending approval entry (T4b test)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('b0000003-0000-0000-0000-000000000000', '2010', 'RDF', 500.00, 0.00,
     '11111111-1111-1111-1111-111111111111'),
    ('b0000003-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 500.00,
     '11111111-1111-1111-1111-111111111111');
COMMIT;

update public.journal_entries
  set status = 'PENDING_APPROVAL'
  where id = 'b0000003-0000-0000-0000-000000000000';

select test.assert(
  (select status from public.journal_entries
    where id = 'b0000003-0000-0000-0000-000000000000') = 'PENDING_APPROVAL',
  'setup: b0000003 promoted to PENDING_APPROVAL'
);

-- ============================================================================
-- CRITERION 1 — UPDATE any field of a POSTED entry is rejected
-- ============================================================================

-- Field edit: description change
select test.expect_fail($$
  update public.journal_entries
    set description = 'tampered'
    where id = 'b0000001-0000-0000-0000-000000000000'
$$, 'UPDATE description on POSTED entry rejected');

-- Status back-transition: POSTED→DRAFT is not the allowed exception
select test.expect_fail($$
  update public.journal_entries
    set status = 'DRAFT'
    where id = 'b0000001-0000-0000-0000-000000000000'
$$, 'POSTED→DRAFT transition rejected (only POSTED→REVERSED allowed)');

-- Combined: POSTED→REVERSED but with an additional field change is also blocked
-- (proves the to_jsonb comparison catches multi-column mutations)
select test.expect_fail($$
  update public.journal_entries
    set status = 'REVERSED', description = 'sneaky edit alongside reversal'
    where id = 'b0000001-0000-0000-0000-000000000000'
$$, 'POSTED→REVERSED with additional field change rejected (only status may change)');

-- ============================================================================
-- CRITERION 2 — DELETE a POSTED entry is rejected
-- ============================================================================

select test.expect_fail($$
  delete from public.journal_entries
    where id = 'b0000001-0000-0000-0000-000000000000'
$$, 'DELETE of POSTED entry rejected');

-- ============================================================================
-- CRITERION 3 — UPDATE or DELETE a line of a POSTED entry is rejected
-- ============================================================================

select test.expect_fail($$
  update public.journal_lines
    set debit = 9999
    where entry_id = 'b0000001-0000-0000-0000-000000000000'
$$, 'UPDATE on line of POSTED entry rejected');

select test.expect_fail($$
  delete from public.journal_lines
    where entry_id = 'b0000001-0000-0000-0000-000000000000'
$$, 'DELETE of line of POSTED entry rejected');

-- ============================================================================
-- CRITERION 4 — POSTED→REVERSED transition is the sole allowed mutation
-- ============================================================================

-- This is the engine's reversal path: status-only change, nothing else.
select test.expect_ok($$
  update public.journal_entries
    set status = 'REVERSED'
    where id = 'b0000001-0000-0000-0000-000000000000'
$$, 'POSTED→REVERSED (status-only) allowed — engine can mark entry reversed');

select test.assert(
  (select status from public.journal_entries
    where id = 'b0000001-0000-0000-0000-000000000000') = 'REVERSED',
  'entry status is now REVERSED after allowed transition'
);

-- ============================================================================
-- PENDING_APPROVAL — description UPDATE is allowed
-- Confirms only POSTED is immutable; PENDING_APPROVAL is still the draft path.
-- ============================================================================

select test.expect_ok($$
  update public.journal_entries
    set description = 'edited while pending approval'
    where id = 'b0000003-0000-0000-0000-000000000000'
$$, 'PENDING_APPROVAL entry description UPDATE allowed (only POSTED is immutable)');

-- ============================================================================
-- CRITERION 5 — DRAFT entry and its lines remain fully editable and deletable
-- ============================================================================

select test.expect_ok($$
  update public.journal_entries
    set description = 'edited draft entry'
    where id = 'b0000002-0000-0000-0000-000000000000'
$$, 'UPDATE description on DRAFT entry allowed');

-- Update a line without changing the balance: only fund changes, debit/credit
-- amounts unchanged, so the deferred balance check at auto-commit still passes.
select test.expect_ok($$
  update public.journal_lines
    set fund = 'PI'
    where entry_id = 'b0000002-0000-0000-0000-000000000000'
      and debit > 0
$$, 'UPDATE fund on DRAFT line allowed (balance unchanged, deferred trigger passes)');

-- Cascade delete of DRAFT entry: block trigger sees OLD.status='DRAFT' → allows;
-- cascaded line deletes see NULL parent status (parent already gone) → allows;
-- deferred balance trigger fires at COMMIT, sees 0 remaining lines → 0=0 → no error.
BEGIN;
delete from public.journal_entries
  where id = 'b0000002-0000-0000-0000-000000000000';
COMMIT;

select test.assert(
  (select count(*)::int from public.journal_entries
    where id = 'b0000002-0000-0000-0000-000000000000') = 0,
  'DRAFT entry deleted cleanly (no immutability block)'
);
select test.assert(
  (select count(*)::int from public.journal_lines
    where entry_id = 'b0000002-0000-0000-0000-000000000000') = 0,
  'DRAFT entry lines cascade-deleted cleanly'
);

-- ============================================================================
-- CLEANUP — b0000001 is REVERSED (not POSTED), b0000003 is PENDING_APPROVAL;
-- neither is blocked by the immutability trigger.
-- Each DELETE cascades to lines; the deferred balance trigger fires at each
-- commit and sees 0 remaining lines → 0=0 → passes.
-- ============================================================================
delete from public.journal_entries where id = 'b0000001-0000-0000-0000-000000000000';
delete from public.journal_entries where id = 'b0000003-0000-0000-0000-000000000000';

reset role;
select '======== ALL P1-T4b TESTS PASSED ========' as result;
