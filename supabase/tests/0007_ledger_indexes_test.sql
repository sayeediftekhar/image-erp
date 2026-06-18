-- ============================================================================
-- P1-T6b TEST SUITE: Ledger index set
-- Run order: shim → 0001–0007 → T1–T6 tests → THIS FILE
-- Proves: all 10 indexes exist on the correct tables; idempotency (re-run
-- with IF NOT EXISTS produces no error and no duplicate entries).
-- No role setup needed — pg_indexes is a system catalog readable by owner;
-- DDL re-run executes as owner.
-- ============================================================================
\set ON_ERROR_STOP on

reset role;

-- ============================================================================
-- A. EXISTENCE — all 10 indexes present on their tables
-- ============================================================================

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_entries'
            and indexname = 'idx_journal_entries_entity_id'),
  'idx_journal_entries_entity_id exists'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_entries'
            and indexname = 'idx_journal_entries_entry_date'),
  'idx_journal_entries_entry_date exists'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_entries'
            and indexname = 'idx_journal_entries_status'),
  'idx_journal_entries_status exists'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_entries'
            and indexname = 'idx_journal_entries_entity_date'),
  'idx_journal_entries_entity_date exists (composite entity_id, entry_date)'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_entries'
            and indexname = 'idx_journal_entries_reverses_entry_id'),
  'idx_journal_entries_reverses_entry_id exists'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_entries'
            and indexname = 'idx_journal_entries_source'),
  'idx_journal_entries_source exists (composite source_module, source_id)'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_lines'
            and indexname = 'idx_journal_lines_entry_id'),
  'idx_journal_lines_entry_id exists'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_lines'
            and indexname = 'idx_journal_lines_account_code'),
  'idx_journal_lines_account_code exists'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_lines'
            and indexname = 'idx_journal_lines_fund'),
  'idx_journal_lines_fund exists'
);

select test.assert(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'journal_lines'
            and indexname = 'idx_journal_lines_party_id'),
  'idx_journal_lines_party_id exists'
);

-- ============================================================================
-- B. IDEMPOTENCY — re-run all 10 IF NOT EXISTS; ON_ERROR_STOP catches errors.
-- PostgreSQL emits a NOTICE and skips silently when an index already exists.
-- ============================================================================
create index if not exists idx_journal_entries_entity_id
  on public.journal_entries(entity_id);
create index if not exists idx_journal_entries_entry_date
  on public.journal_entries(entry_date);
create index if not exists idx_journal_entries_status
  on public.journal_entries(status);
create index if not exists idx_journal_entries_entity_date
  on public.journal_entries(entity_id, entry_date);
create index if not exists idx_journal_entries_reverses_entry_id
  on public.journal_entries(reverses_entry_id);
create index if not exists idx_journal_entries_source
  on public.journal_entries(source_module, source_id);
create index if not exists idx_journal_lines_entry_id
  on public.journal_lines(entry_id);
create index if not exists idx_journal_lines_account_code
  on public.journal_lines(account_code);
create index if not exists idx_journal_lines_fund
  on public.journal_lines(fund);
create index if not exists idx_journal_lines_party_id
  on public.journal_lines(party_id);

-- Explicit count: exactly 10 named indexes, no duplicates
select test.assert(
  (select count(*)::int from pg_indexes
   where schemaname = 'public'
     and indexname in (
       'idx_journal_entries_entity_id',
       'idx_journal_entries_entry_date',
       'idx_journal_entries_status',
       'idx_journal_entries_entity_date',
       'idx_journal_entries_reverses_entry_id',
       'idx_journal_entries_source',
       'idx_journal_lines_entry_id',
       'idx_journal_lines_account_code',
       'idx_journal_lines_fund',
       'idx_journal_lines_party_id'
     )) = 10,
  'idempotency: count still 10 after re-run (IF NOT EXISTS skipped all)'
);

reset role;
select '======== ALL P1-T6b TESTS PASSED ========' as result;
