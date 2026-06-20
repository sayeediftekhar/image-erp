-- ============================================================================
-- P2-T2b TEST SUITE: migration 0013 (patient advances account + setting)
-- Run order: shim → 0001–0013 → 0001_test → … → 0012_test → THIS FILE
-- Proves:
--   A. Account 2150 exists with type=LIABILITY, normal_balance=CREDIT, fund=PI
--   B. Setting delivery_balance_flag_days = '4'
--   C. delivery_balance.close_entry_id column exists (nullable FK to journal_entries)
-- ============================================================================
\set ON_ERROR_STOP on

-- ── CRITERION A ──────────────────────────────────────────────────────────────

select test.assert(
  exists(
    select 1 from public.accounts
    where code             = '2150'
      and name             = 'Patient Advances / Deposits Received'
      and type             = 'LIABILITY'
      and normal_balance   = 'CREDIT'
      and fund             = 'PI'
      and is_control       = false
      and requires_approval = false
  ),
  '0013: account 2150 — LIABILITY/CREDIT/PI, not is_control, not requires_approval'
);

-- ── CRITERION B ──────────────────────────────────────────────────────────────

select test.assert(
  (select value from public.settings where key = 'delivery_balance_flag_days') = '4',
  '0013: setting delivery_balance_flag_days = ''4'''
);

-- ── CRITERION C ──────────────────────────────────────────────────────────────

select test.assert(
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'delivery_balance'
      and column_name  = 'close_entry_id'
      and is_nullable  = 'YES'
  ),
  '0013: delivery_balance.close_entry_id column exists and is nullable'
);

select '======== ALL P2-T2b PATIENT_ADVANCES TESTS PASSED ========' as result;
