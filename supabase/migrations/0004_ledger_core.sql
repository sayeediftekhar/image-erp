-- ============================================================================
-- IMAGE ERP — Migration 0004: Ledger core (journal_entries + journal_lines)
-- Iron Laws touched:
--   L2 — Σdebit=Σcredit enforced as a deferrable constraint trigger;
--         no write grant to authenticated = only the posting engine writes lines.
--   L3 — require_actor + audit trigger on both tables; actor never null.
--   L4 — every line carries fund; every entry carries entity.
--   L5 — RLS entity-scoped for ENTRY reads; no write policy for authenticated.
--
-- Scope boundary:
--   T4b — posted-entry immutability trigger (block UPDATE/DELETE on POSTED rows)
--   T5  — posting engine, draft→posted promotion, reverseEntry(), approval gate
-- ============================================================================

-- ---------- public.journal_entries (header) ----------------------------------
create table public.journal_entries (
  id                uuid          primary key default gen_random_uuid(),
  entity_id         uuid          not null references public.entities(id) on delete restrict,
  entry_date        date          not null,
  description       text          not null,
  ref               text,
  status            text          not null default 'DRAFT'
                                  check (status in ('DRAFT','PENDING_APPROVAL','POSTED','REVERSED')),
  reverses_entry_id uuid          references public.journal_entries(id) on delete restrict,
  source_module     text          not null default 'MANUAL',
  source_id         uuid,
  entered_at        timestamptz   not null default now(),
  created_by        uuid          not null default auth.uid(),
  created_at        timestamptz   not null default now(),
  updated_by        uuid,
  updated_at        timestamptz
);

create trigger trg_journal_entries_actor before insert on public.journal_entries
  for each row execute function app.require_actor();
create trigger trg_journal_entries_touch  before update on public.journal_entries
  for each row execute function app.touch_updated();

-- ---------- public.journal_lines (the postings) ------------------------------
-- FK entry_id ON DELETE CASCADE: deleting a draft entry removes its lines.
-- FK account_code ON DELETE RESTRICT: no hard-delete of any account used in a line.
-- FK party_id ON DELETE RESTRICT: same guarantee for parties.
-- The RESTRICT FKs are the complete "no hard-delete if used" guarantee for
-- accounts and parties — no separate trigger needed for that half of issue #1.
create table public.journal_lines (
  id            uuid          primary key default gen_random_uuid(),
  entry_id      uuid          not null references public.journal_entries(id) on delete cascade,
  account_code  text          not null references public.accounts(code) on delete restrict,
  party_id      uuid                   references public.parties(id) on delete restrict,
  fund          fund          not null,
  debit         numeric(15,2) not null default 0 check (debit  >= 0),
  credit        numeric(15,2) not null default 0 check (credit >= 0),
  check (not (debit > 0 and credit > 0)),  -- a line is debit XOR credit, never both
  check (debit > 0 or credit > 0),         -- a line is never zero on both sides
  created_by    uuid          not null default auth.uid(),
  created_at    timestamptz   not null default now(),
  updated_by    uuid,
  updated_at    timestamptz
);

create trigger trg_journal_lines_actor before insert on public.journal_lines
  for each row execute function app.require_actor();
create trigger trg_journal_lines_touch  before update on public.journal_lines
  for each row execute function app.touch_updated();

-- ---------- spine guarantee: Σdebit = Σcredit per entry (Law 2) -------------
-- SECURITY DEFINER guarantees the balance check can sum all lines of the entry
-- without being filtered by the caller's RLS policies — the constraint must see
-- the complete row set regardless of which role initiated the triggering DML.
-- Runs at COMMIT (deferrable initially deferred): the engine inserts header +
-- all lines in one transaction; the check must see the complete set.
-- coalesce(_dr,0) handles zero-line entries (NULL sums → 0=0 → passes).
-- Zero-line orphan prevention is the engine's (T5) responsibility, not a second
-- trigger here (would be over-build; noted in CONTEXT.md as a conscious choice).
create or replace function app.check_journal_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _entry_id uuid := coalesce(new.entry_id, old.entry_id);
  _dr       numeric;
  _cr       numeric;
begin
  select sum(debit), sum(credit)
    into _dr, _cr
    from public.journal_lines
   where entry_id = _entry_id;

  if coalesce(_dr, 0) <> coalesce(_cr, 0) then
    raise exception
      'journal entry % is unbalanced (Σdebit=%, Σcredit=%)',
      _entry_id, coalesce(_dr, 0), coalesce(_cr, 0);
  end if;

  return null;
end;
$$;

create constraint trigger trg_journal_balance
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function app.check_journal_balance();

-- ---------- audit triggers ---------------------------------------------------
create trigger trg_journal_entries_audit
  after insert or update or delete on public.journal_entries
  for each row execute function audit.log_change();

create trigger trg_journal_lines_audit
  after insert or update or delete on public.journal_lines
  for each row execute function audit.log_change();

-- ---------- issue #1: lock account type/normal_balance once used -------------
-- Uses direct OLD/NEW column access — accounts-specific, intentionally not
-- generalised. Needs SECURITY DEFINER to read journal_lines without being
-- filtered by the caller's RLS policies (e.g. an ADMIN updating accounts can
-- only see their own entity's lines under RLS, but the lock must check all lines
-- across all entities that reference this account code).
create or replace function app.lock_account_if_used()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.type <> old.type or new.normal_balance <> old.normal_balance)
     and exists (select 1 from public.journal_lines where account_code = old.code)
  then
    raise exception
      'account % has journal_lines — type and normal_balance are locked once used (Blueprint §8)',
      old.code;
  end if;
  return new;
end;
$$;

create trigger trg_accounts_lock_if_used
  before update on public.accounts
  for each row execute function app.lock_account_if_used();

-- ---------- RLS (Law 5) ------------------------------------------------------
alter table public.journal_entries enable row level security;
alter table public.journal_lines   enable row level security;

-- READ: ENTRY sees only their own entity's entries; oversight roles see all.
-- There is NO write policy for authenticated on either table. The posting engine
-- runs server-side under service_role (BYPASSRLS) and is the sole writer (Law 2).
-- Any direct write attempt from an authenticated session fails at the privilege
-- layer (SELECT-only grant below), before RLS is even evaluated.
create policy journal_entries_read on public.journal_entries
  for select to authenticated
  using (
    app.current_role() in ('ADMIN', 'HQ_FINANCE', 'READ_ONLY')
    or entity_id = app.current_entity()
  );

-- journal_lines: scope by the parent entry's entity using a correlated subquery.
-- The subquery on journal_entries is itself RLS-filtered, so ENTRY only reaches
-- lines whose parent entry is already visible to them.
create policy journal_lines_read on public.journal_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.journal_entries je
      where je.id = entry_id
        and (
          app.current_role() in ('ADMIN', 'HQ_FINANCE', 'READ_ONLY')
          or je.entity_id = app.current_entity()
        )
    )
  );

-- SELECT only. No INSERT / UPDATE / DELETE granted to authenticated.
-- Engine writes via service_role (BYPASSRLS).
grant select on public.journal_entries to authenticated;
grant select on public.journal_lines   to authenticated;
