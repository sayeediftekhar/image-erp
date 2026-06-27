-- ============================================================================
-- P2-T4a TEST SUITE: cheque_number column on journal_entries
-- Run order: shim → 0001–0015 → 0001_test → … → THIS FILE
-- Proves:
--   1. cheque_number column exists on journal_entries
--   2. Nullable — existing entries accept NULL
--   3. Can be set and queried
--   4. Does NOT affect balance constraint — a non-cheque entry (cheque_number=NULL)
--      still satisfies the existing Σdr=Σcr trigger
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
select auth.login_as('11111111-1111-1111-1111-111111111111');

-- ---------- A1: column exists and is nullable --------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'journal_entries'
      and column_name  = 'cheque_number'
  ) then
    raise exception 'FAIL A1: cheque_number column missing from journal_entries';
  end if;
  if (
    select is_nullable from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'journal_entries'
      and column_name  = 'cheque_number'
  ) <> 'YES' then
    raise exception 'FAIL A1: cheque_number must be nullable';
  end if;
  raise notice 'OK A1: cheque_number column exists and is nullable';
end $$;

-- ---------- A2: can be set on a new entry and round-trips correctly ----------
begin;
insert into public.journal_entries
  (id, entity_id, entry_date, description, cheque_number,
   entered_at, created_by, source_module)
  values (
    'f0000001-0000-0000-0000-000000000001',
    (select id from public.entities where code = 'JAL'),
    current_date, 'Cheque-column test entry (T4a)', 'CHQ-TEST-001',
    now(), '11111111-1111-1111-1111-111111111111', 'EXPENSE'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('f0000001-0000-0000-0000-000000000001', '5050', 'PI', 1000.00, 0.00,
     '11111111-1111-1111-1111-111111111111'),
    ('f0000001-0000-0000-0000-000000000001', '1015', 'PI', 0.00, 1000.00,
     '11111111-1111-1111-1111-111111111111');
commit;

do $$
declare v_cheque text;
begin
  select cheque_number into v_cheque
    from public.journal_entries
   where id = 'f0000001-0000-0000-0000-000000000001';
  if v_cheque <> 'CHQ-TEST-001' then
    raise exception 'FAIL A2: cheque_number round-trip failed, got: %', v_cheque;
  end if;
  raise notice 'OK A2: cheque_number set and queried correctly';
end $$;

-- ---------- A3: NULL cheque_number accepted (non-cheque expenses) ------------
begin;
insert into public.journal_entries
  (id, entity_id, entry_date, description, cheque_number,
   entered_at, created_by, source_module)
  values (
    'f0000001-0000-0000-0000-000000000002',
    (select id from public.entities where code = 'JAL'),
    current_date, 'Cash-petty-cash entry (no cheque)', null,
    now(), '11111111-1111-1111-1111-111111111111', 'EXPENSE'
  );
insert into public.journal_lines (entry_id, account_code, fund, debit, credit, created_by)
  values
    ('f0000001-0000-0000-0000-000000000002', '5040', 'PI', 500.00, 0.00,
     '11111111-1111-1111-1111-111111111111'),
    ('f0000001-0000-0000-0000-000000000002', '1015', 'PI', 0.00, 500.00,
     '11111111-1111-1111-1111-111111111111');
commit;

do $$
declare v_cheque text;
begin
  select cheque_number into v_cheque
    from public.journal_entries
   where id = 'f0000001-0000-0000-0000-000000000002';
  if v_cheque is not null then
    raise exception 'FAIL A3: cheque_number should be NULL for cash entry, got: %', v_cheque;
  end if;
  raise notice 'OK A3: NULL cheque_number accepted for non-cheque entry';
end $$;

-- ---------- cleanup ----------------------------------------------------------
reset role;
