-- ============================================================================
-- P1-T4 TEST SUITE: Ledger core (journal_entries + journal_lines)
-- Run order: shim → 0001 → 0002 → 0003 → 0004 → 0001_test → 0002_test →
--            0003_test → THIS FILE
-- Proves: CHECK constraints; spine guarantee (deferred trigger); cascade delete;
-- entity-scoped RLS per role; no authenticated write path; issue #1 account lock
-- + FK restrict; audit attribution; require_actor.
--
-- Bootstrap users from T1 test run (already present in erp_test):
--   11111111... = ADMIN        22222222... = HQ_FINANCE
--   33333333... = ENTRY (JAL)  44444444... = READ_ONLY
--
-- Pre-specified entry UUIDs (sentinel values — never clash with gen_random_uuid):
--   a0000001-... = JAL balanced entry (RLS + audit tests)
--   a0000002-... = NAS balanced entry (RLS entity-scoping test)
--   a0000003-... = JAL entry using account ZLOCK (issue #1 test)
--   a0000099-... = throwaway balanced entry for cascade delete test (inserted+deleted same txn)
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

-- ============================================================================
-- SETUP — insert two balanced entries as owner (stands in for the engine).
-- Uses explicit BEGIN/COMMIT: the deferred balance trigger fires at COMMIT and
-- must see the complete set of lines. COMMIT succeeds → balanced entries committed.
-- ============================================================================

BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'a0000001-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'JAL test entry (T4)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('a0000001-0000-0000-0000-000000000000', '2010', 'RDF', 5000.00, 0.00, '11111111-1111-1111-1111-111111111111'),
    ('a0000001-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 5000.00, '11111111-1111-1111-1111-111111111111');
COMMIT;  -- deferred trigger fires: Σdr=5000, Σcr=5000 → passes

BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'a0000002-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'NAS'),
    current_date, 'NAS test entry (T4)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('a0000002-0000-0000-0000-000000000000', '2010', 'RDF', 1000.00, 0.00, '11111111-1111-1111-1111-111111111111'),
    ('a0000002-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 1000.00, '11111111-1111-1111-1111-111111111111');
COMMIT;  -- deferred trigger fires: Σdr=1000, Σcr=1000 → passes

select test.assert(
  (select count(*)::int from public.journal_entries
    where id in ('a0000001-0000-0000-0000-000000000000','a0000002-0000-0000-0000-000000000000')) = 2,
  'setup: both balanced entries committed'
);
select test.assert(
  (select count(*)::int from public.journal_lines
    where entry_id in ('a0000001-0000-0000-0000-000000000000','a0000002-0000-0000-0000-000000000000')) = 4,
  'setup: all 4 lines committed'
);

-- ============================================================================
-- A. CHECK CONSTRAINTS ON journal_lines
-- entry_id 'a0000001-...' exists (committed above) so FK passes; the CHECK fires.
-- ============================================================================

select test.expect_fail($$
  insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
    values ('a0000001-0000-0000-0000-000000000000', '2010', 'RDF', 100, 50,
            '11111111-1111-1111-1111-111111111111')
$$, 'line with debit>0 and credit>0 rejected (XOR constraint)');

select test.expect_fail($$
  insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
    values ('a0000001-0000-0000-0000-000000000000', '2010', 'RDF', 0, 0,
            '11111111-1111-1111-1111-111111111111')
$$, 'line with debit=0 and credit=0 rejected (never-zero constraint)');

select test.expect_fail($$
  insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
    values ('a0000001-0000-0000-0000-000000000000', '2010', 'RDF', -10, 0,
            '11111111-1111-1111-1111-111111111111')
$$, 'negative debit rejected (debit >= 0 constraint)');

select test.expect_fail($$
  insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
    values ('a0000001-0000-0000-0000-000000000000', '2010', 'RDF', 0, -10,
            '11111111-1111-1111-1111-111111111111')
$$, 'negative credit rejected (credit >= 0 constraint)');

-- ============================================================================
-- B. SPINE GUARANTEE — deferred balance trigger
-- ============================================================================

-- B1: balanced entries already committed in setup (proven above). ✓

-- B2: Unbalanced entry rejected by the deferred trigger.
-- Pattern: DO block with SET CONSTRAINTS ALL IMMEDIATE forces the deferred trigger
-- to fire within a PL/pgSQL subtransaction, where the EXCEPTION handler catches
-- the raised error. The savepoint rolls back the bad inserts; the DO block exits
-- normally; ON_ERROR_STOP is never triggered.
DO $$
DECLARE
  v_jal_id uuid;
  v_entry  uuid;
BEGIN
  SELECT id INTO v_jal_id FROM public.entities WHERE code = 'JAL';

  BEGIN
    INSERT INTO public.journal_entries
      (entity_id, entry_date, description, entered_at, created_by, source_module)
      VALUES (v_jal_id, CURRENT_DATE, 'unbalanced test T4', now(),
              '11111111-1111-1111-1111-111111111111', 'MANUAL')
      RETURNING id INTO v_entry;

    -- Only one debit line, no matching credit → unbalanced
    INSERT INTO public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
      VALUES (v_entry, '2010', 'RDF', 100.00, 0.00,
              '11111111-1111-1111-1111-111111111111');

    -- Force the deferred trigger to fire within this subtransaction
    SET CONSTRAINTS ALL IMMEDIATE;

    -- Reaching here means the constraint didn't fire → that's wrong
    RAISE EXCEPTION 'FAIL: unbalanced entry was not rejected by the balance constraint';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    -- Savepoint rolled back; bad entry+line are gone
    PERFORM test.assert(
      true,
      'unbalanced entry rejected by deferred constraint trigger (SET CONSTRAINTS ALL IMMEDIATE)'
    );
  END;
END;
$$;

-- B3: Cascade DELETE of a balanced DRAFT entry fires the deferred trigger for
-- the cascade-deleted lines. At COMMIT, the trigger checks the entry's balance —
-- sees 0 remaining lines (both already deleted within the same transaction),
-- so sum(debit) = sum(credit) = NULL → coalesce(0) = 0 = 0 → no error.
-- COMMIT success here is the proof; ON_ERROR_STOP would abort if it failed.
BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'a0000099-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'cascade delete test T4', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('a0000099-0000-0000-0000-000000000000', '2010', 'RDF', 300.00, 0.00, '11111111-1111-1111-1111-111111111111'),
    ('a0000099-0000-0000-0000-000000000000', '1590', 'RDF', 0.00, 300.00, '11111111-1111-1111-1111-111111111111');
delete from public.journal_entries where id = 'a0000099-0000-0000-0000-000000000000';
COMMIT;  -- deferred trigger fires for cascade-deleted lines → 0=0 → no error

select test.assert(
  (select count(*)::int from public.journal_entries
    where id = 'a0000099-0000-0000-0000-000000000000') = 0,
  'cascade delete: entry gone after DELETE'
);
select test.assert(
  (select count(*)::int from public.journal_lines
    where entry_id = 'a0000099-0000-0000-0000-000000000000') = 0,
  'cascade delete: lines cascade-deleted cleanly; no balance-trigger error (COMMIT succeeded)'
);

-- ============================================================================
-- C. RLS — entity-scoped reads
-- At this point: a0000001 (JAL, 2 lines) and a0000002 (NAS, 2 lines) exist.
-- ============================================================================

set role authenticated;

-- ADMIN sees all entries and lines
select auth.login_as('11111111-1111-1111-1111-111111111111');
select test.assert(
  (select count(*)::int from public.journal_entries) = 2,
  'ADMIN sees all journal_entries (2)'
);
select test.assert(
  (select count(*)::int from public.journal_lines) = 4,
  'ADMIN sees all journal_lines (4)'
);

-- HQ_FINANCE sees all
select auth.login_as('22222222-2222-2222-2222-222222222222');
select test.assert(
  (select count(*)::int from public.journal_entries) = 2,
  'HQ_FINANCE sees all journal_entries (2)'
);
select test.assert(
  (select count(*)::int from public.journal_lines) = 4,
  'HQ_FINANCE sees all journal_lines (4)'
);

-- READ_ONLY sees all
select auth.login_as('44444444-4444-4444-4444-444444444444');
select test.assert(
  (select count(*)::int from public.journal_entries) = 2,
  'READ_ONLY sees all journal_entries (2)'
);
select test.assert(
  (select count(*)::int from public.journal_lines) = 4,
  'READ_ONLY sees all journal_lines (4)'
);

-- ENTRY (JAL) sees only JAL entry and its lines; NAS entry is invisible
select auth.login_as('33333333-3333-3333-3333-333333333333');
select test.assert(
  (select count(*)::int from public.journal_entries) = 1,
  'ENTRY (JAL) sees only 1 journal_entry (entity-scoped RLS)'
);
select test.assert(
  exists (select 1 from public.journal_entries where id = 'a0000001-0000-0000-0000-000000000000'),
  'ENTRY (JAL) can see the JAL entry'
);
select test.assert(
  not exists (select 1 from public.journal_entries where id = 'a0000002-0000-0000-0000-000000000000'),
  'ENTRY (JAL) cannot see the NAS entry (entity-scoped RLS)'
);
select test.assert(
  (select count(*)::int from public.journal_lines) = 2,
  'ENTRY (JAL) sees only 2 journal_lines (JAL lines; NAS lines invisible)'
);

-- ============================================================================
-- D. NO AUTHENTICATED WRITE PATH (Law 2)
-- Grant is SELECT-only for authenticated → any write fails at privilege layer,
-- NOT silently via RLS. Use expect_fail (permission denied), not 0-row pattern.
-- ============================================================================

-- ENTRY cannot INSERT journal_entries or journal_lines (no INSERT grant)
select auth.login_as('33333333-3333-3333-3333-333333333333');

select test.expect_fail($$
  insert into public.journal_entries
    (entity_id, entry_date, description, entered_at, created_by, source_module)
    values (
      (select id from public.entities where code = 'JAL'),
      current_date, 'attempted direct write', now(),
      '33333333-3333-3333-3333-333333333333', 'MANUAL'
    )
$$, 'ENTRY cannot INSERT journal_entries (no write grant — permission denied)');

select test.expect_fail($$
  insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
    values ('a0000001-0000-0000-0000-000000000000', '2010', 'RDF', 100, 0,
            '33333333-3333-3333-3333-333333333333')
$$, 'ENTRY cannot INSERT journal_lines (no write grant — permission denied)');

-- ADMIN via authenticated role is also blocked — no write grant for anyone
select auth.login_as('11111111-1111-1111-1111-111111111111');

select test.expect_fail($$
  insert into public.journal_entries
    (entity_id, entry_date, description, entered_at, created_by, source_module)
    values (
      (select id from public.entities where code = 'JAL'),
      current_date, 'admin direct write attempt', now(),
      '11111111-1111-1111-1111-111111111111', 'MANUAL'
    )
$$, 'ADMIN (authenticated role) cannot INSERT journal_entries (no write grant)');

select test.expect_fail($$
  insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
    values ('a0000001-0000-0000-0000-000000000000', '2010', 'RDF', 100, 0,
            '11111111-1111-1111-1111-111111111111')
$$, 'ADMIN (authenticated role) cannot INSERT journal_lines (no write grant)');

-- ============================================================================
-- E. ISSUE #1 — lock account type/normal_balance once used in journal_lines
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

-- Create a test account (currently unused in journal_lines)
insert into public.accounts (code, name, type, normal_balance)
  values ('ZLOCK', 'Lock Test Account', 'EXPENSE', 'DEBIT');

-- E1: Unused account — type and normal_balance are freely editable
select test.expect_ok($$
  update public.accounts set type = 'ASSET' where code = 'ZLOCK'
$$, 'can change type on unused account (issue #1 lock not yet triggered)');

select test.expect_ok($$
  update public.accounts set normal_balance = 'CREDIT' where code = 'ZLOCK'
$$, 'can change normal_balance on unused account');

-- E2: Make ZLOCK "used" by inserting a balanced entry referencing it.
-- ZLOCK is now ASSET/CREDIT (after the updates above).
BEGIN;
insert into public.journal_entries
  (id, entity_id, entry_date, description, entered_at, created_by, source_module)
  values (
    'a0000003-0000-0000-0000-000000000000',
    (select id from public.entities where code = 'JAL'),
    current_date, 'ZLOCK lock test entry (T4)', now(),
    '11111111-1111-1111-1111-111111111111', 'MANUAL'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    -- ZLOCK (ASSET/CREDIT) on credit side
    ('a0000003-0000-0000-0000-000000000000', 'ZLOCK', 'RDF', 0.00, 200.00,
     '11111111-1111-1111-1111-111111111111'),
    -- 2010 (LIABILITY/CREDIT) on debit side
    ('a0000003-0000-0000-0000-000000000000', '2010',  'RDF', 200.00, 0.00,
     '11111111-1111-1111-1111-111111111111');
COMMIT;  -- Σdr=200, Σcr=200 → balanced → committed; ZLOCK is now "used"

-- E3: Used account — type and normal_balance are locked
select test.expect_fail($$
  update public.accounts set type = 'EXPENSE' where code = 'ZLOCK'
$$, 'cannot change type on account used in journal_lines (issue #1 lock)');

select test.expect_fail($$
  update public.accounts set normal_balance = 'DEBIT' where code = 'ZLOCK'
$$, 'cannot change normal_balance on account used in journal_lines (issue #1 lock)');

-- Non-structural columns remain editable on a used account
select test.expect_ok($$
  update public.accounts set name = 'Lock Test Account v2' where code = 'ZLOCK'
$$, 'can change name on used account (lock applies only to type/normal_balance)');

-- E4: FK RESTRICT — cannot delete an account that has journal_lines
select test.expect_fail($$
  delete from public.accounts where code = 'ZLOCK'
$$, 'cannot delete account used in journal_lines (FK ON DELETE RESTRICT)');

-- E5: After cascade-deleting the referencing entry, ZLOCK becomes unused and can be deleted.
-- The cascade-delete fires the deferred balance trigger; at COMMIT, 0 lines → 0=0 → no error.
delete from public.journal_entries where id = 'a0000003-0000-0000-0000-000000000000';

select test.expect_ok($$
  delete from public.accounts where code = 'ZLOCK'
$$, 'can delete account once all referencing journal_lines are gone (FK RESTRICT lifted)');

-- ============================================================================
-- F. AUDIT + REQUIRE_ACTOR
-- ============================================================================

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

-- Audit row written for journal_entries INSERT (record_id = uuid id)
select test.assert(
  exists (
    select 1 from audit.audit_log
    where table_name = 'journal_entries'
      and op = 'INSERT'
      and record_id = 'a0000001-0000-0000-0000-000000000000'
      and new_json->>'id' = 'a0000001-0000-0000-0000-000000000000'
      and old_json is null
  ),
  'audit: journal_entries INSERT generates audit row with record_id = uuid id'
);

-- Audit rows written for journal_lines INSERT (record_id = uuid id of each line)
select test.assert(
  (select count(*)::int from audit.audit_log
    where table_name = 'journal_lines'
      and op = 'INSERT'
      and (new_json->>'entry_id') = 'a0000001-0000-0000-0000-000000000000'
      and length(record_id) = 36) = 2,
  'audit: journal_lines INSERTs generate audit rows with record_id = uuid line id'
);

-- require_actor: null-actor INSERT into journal_entries rejected (Iron Law 3)
select auth.logout();
select test.expect_fail($$
  insert into public.journal_entries
    (entity_id, entry_date, description, entered_at, source_module)
    values (
      (select id from public.entities where code = 'JAL'),
      current_date, 'null actor test', now(), 'MANUAL'
    )
$$, 'journal_entries INSERT with null actor rejected (require_actor / Iron Law 3)');

-- ============================================================================
-- CLEANUP: delete test entries (cascade to lines).
-- Each DELETE is a separate auto-committed statement; the deferred balance trigger
-- fires at each commit and sees 0 remaining lines for the deleted entry → 0=0.
-- ============================================================================
reset role;
delete from public.journal_entries
  where id in ('a0000001-0000-0000-0000-000000000000',
               'a0000002-0000-0000-0000-000000000000');
-- a0000003 and ZLOCK already removed in Section E above
-- a0000099 was inserted and deleted in the same transaction (Section B3)

reset role;
select '======== ALL P1-T4 TESTS PASSED ========' as result;
