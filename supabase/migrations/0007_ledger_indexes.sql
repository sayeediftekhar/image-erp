-- ============================================================================
-- IMAGE ERP — Migration 0007: Ledger index set (P1-T6b)
-- Performance-only: CREATE INDEX IF NOT EXISTS — no schema, data, RLS, or
-- trigger changes. Indexes change query speed, never query results.
-- IF NOT EXISTS makes the migration re-runnable (idempotent).
-- ============================================================================

-- ---------- journal_entries --------------------------------------------------
create index if not exists idx_journal_entries_entity_id
  on public.journal_entries(entity_id);

create index if not exists idx_journal_entries_entry_date
  on public.journal_entries(entry_date);

create index if not exists idx_journal_entries_status
  on public.journal_entries(status);

-- Composite: "this clinic, this period" — avoids two separate index scans
create index if not exists idx_journal_entries_entity_date
  on public.journal_entries(entity_id, entry_date);

-- Sparse column: walk the reversal chain (POSTED → REVERSED)
create index if not exists idx_journal_entries_reverses_entry_id
  on public.journal_entries(reverses_entry_id);

-- Trace any GL entry back to its originating module document
create index if not exists idx_journal_entries_source
  on public.journal_entries(source_module, source_id);

-- ---------- journal_lines ----------------------------------------------------
-- The header→lines join: used in every report
create index if not exists idx_journal_lines_entry_id
  on public.journal_lines(entry_id);

create index if not exists idx_journal_lines_account_code
  on public.journal_lines(account_code);

create index if not exists idx_journal_lines_fund
  on public.journal_lines(fund);

-- Nullable: B-tree indexes NULLs, so lines with no party are correctly included
create index if not exists idx_journal_lines_party_id
  on public.journal_lines(party_id);
