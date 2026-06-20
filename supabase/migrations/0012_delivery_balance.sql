-- ============================================================================
-- IMAGE ERP — Migration 0012: Delivery balance tracker (P2-T2)
-- Table: delivery_balance — memo/ageing tracker for unpaid delivery balances.
-- NOT a posted receivable (Q1: cash basis). Advance already posted as income
-- when received; this table tracks the outstanding expected balance for
-- manager follow-up (ageing nudge).
-- Written by P2-T2 submit service (service_role, BYPASSRLS) at submit time.
-- Close action (balance paid → CLOSED + post income) is P2-T2b/P2-T3.
--
-- Iron Laws:
--   L1 — figures entered by the manager; none inferred.
--   L3 — require_actor + audit trigger; actor never null.
--   L4 — every row carries entity_id.
--   L5 — entity-scoped RLS: ENTRY writes own entity; ADMIN/HQ/READ_ONLY see all.
-- ============================================================================

create table public.delivery_balance (
  id               uuid          primary key default gen_random_uuid(),
  entity_id        uuid          not null references public.entities(id) on delete restrict,
  -- Linked to the revenue_day that created this row. ON DELETE RESTRICT:
  -- deleting a submitted revenue_day is blocked if open balances exist
  -- (preserves audit trail; void flow is a future feature).
  revenue_day_id   uuid          references public.revenue_day(id) on delete restrict,
  receipt_no       text,
  patient_name     text          not null,
  phone            text,
  delivery_type    text          not null check (delivery_type in ('CSECTION','SAFE')),
  advance_paid     numeric(15,2) not null default 0,
  expected_balance numeric(15,2) not null default 0,
  expected_date    date,
  -- OPEN = balance not yet collected. CLOSED = balance payment recorded.
  status           text          not null default 'OPEN'
                                 check (status in ('OPEN','CLOSED')),
  closed_date      date,
  created_by       uuid          not null default auth.uid(),
  created_at       timestamptz   not null default now(),
  updated_by       uuid,
  updated_at       timestamptz
);

create index on public.delivery_balance (entity_id, status);
create index on public.delivery_balance (revenue_day_id);

create trigger trg_delivery_balance_actor before insert on public.delivery_balance
  for each row execute function app.require_actor();
create trigger trg_delivery_balance_touch  before update on public.delivery_balance
  for each row execute function app.touch_updated();
create trigger trg_delivery_balance_audit
  after insert or update or delete on public.delivery_balance
  for each row execute function audit.log_change();

-- ---------- RLS (Law 5) -------------------------------------------------------
alter table public.delivery_balance enable row level security;

-- READ: oversight roles see all; ENTRY is entity-scoped.
create policy delivery_balance_read on public.delivery_balance
  for select to authenticated
  using (
    app.current_role() in ('ADMIN','HQ_FINANCE','READ_ONLY')
    or entity_id = app.current_entity()
  );

-- WRITE: ENTRY can INSERT/UPDATE for own entity.
-- The submit service (P2-T2) writes OPEN rows via service_role (BYPASSRLS).
-- The close action (P2-T2b/P2-T3) will use this policy for ENTRY update (CLOSED).
create policy delivery_balance_entry_write on public.delivery_balance
  for all to authenticated
  using  (app.current_role() = 'ENTRY' and entity_id = app.current_entity())
  with check (app.current_role() = 'ENTRY' and entity_id = app.current_entity());

create policy delivery_balance_admin_write on public.delivery_balance
  for all to authenticated
  using  (app.is_admin())
  with check (app.is_admin());

-- SELECT + INSERT + UPDATE to authenticated (RLS scopes who can do what).
-- No DELETE grant — records stay for audit. Close action uses UPDATE status→CLOSED.
grant select, insert, update on public.delivery_balance to authenticated;
