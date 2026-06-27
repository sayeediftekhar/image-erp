-- ============================================================================
-- IMAGE ERP — Migration 0014: Month-completeness gate (P2-T3f-B)
--
-- Schema changes:
--   1. entities.go_live_month (nullable text YYYY-MM) — entity's first gated
--      month; NULL = gate never enforces for this entity (safe default, so
--      no existing entity is gated until an admin sets this explicitly).
--   2. month_gate_override — per-entity per-month admin override: lets a
--      manager enter month N despite the prior month being incomplete.
--
-- Iron Laws:
--   L3 — require_actor + audit trigger + touch; actor never null.
--   L5 — RLS: ADMIN read/write all; ENTRY read own entity (gate check path);
--        HQ_FINANCE / READ_ONLY excluded (neither role is ever gated).
--
-- Deployment order: this migration MUST be applied before any code that reads
-- entities.go_live_month or queries month_gate_override is deployed.
-- ============================================================================

-- ---------- 1. entities.go_live_month ----------------------------------------
-- NULL = gate dormant for this entity (safe default).
-- Format enforced by CHECK constraint: must be YYYY-MM or NULL.
alter table public.entities
  add column go_live_month text
  constraint chk_go_live_month_fmt
    check (go_live_month is null or go_live_month ~ '^\d{4}-\d{2}$');

-- ---------- 2. month_gate_override -------------------------------------------
-- One row per entity+month = admin grants that manager permission to enter
-- gated_month despite the prior month being incomplete.
-- unique(entity_id, gated_month): re-granting the same month UPSERTs (see
-- application layer) rather than inserting a duplicate row.
-- ON DELETE CASCADE: removing an entity cleans up its overrides.
create table public.month_gate_override (
  id          uuid        primary key default gen_random_uuid(),
  entity_id   uuid        not null references public.entities(id) on delete cascade,
  gated_month text        not null
                          constraint chk_gated_month_fmt
                          check (gated_month ~ '^\d{4}-\d{2}$'),
  granted_by  uuid        not null,   -- auth.users id of the admin who granted
  granted_at  timestamptz not null default now(),
  note        text,
  created_by  uuid        not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz,
  constraint uq_gate_override unique (entity_id, gated_month)
);

-- ---------- Triggers (Iron Law 3) --------------------------------------------
create trigger trg_month_gate_override_actor
  before insert on public.month_gate_override
  for each row execute function app.require_actor();

create trigger trg_month_gate_override_touch
  before update on public.month_gate_override
  for each row execute function app.touch_updated();

-- AFTER trigger fires even if BEFORE trigger aborts a row — but require_actor
-- raises an exception (aborts transaction), so audit_log only sees valid rows.
create trigger trg_month_gate_override_audit
  after insert or update or delete on public.month_gate_override
  for each row execute function audit.log_change();

-- ---------- RLS --------------------------------------------------------------
alter table public.month_gate_override enable row level security;

-- ADMIN: full read/write (admin's session is used for all override mutations)
create policy gate_override_admin on public.month_gate_override
  for all to authenticated
  using  (app.is_admin())
  with check (app.is_admin());

-- ENTRY: SELECT own entity only — so the server-side gate check (called with
-- the manager's supabase session) can see whether an override exists for their
-- entity+month without needing the service role.
create policy gate_override_entry_read on public.month_gate_override
  for select to authenticated
  using (
    entity_id = (
      select entity_id from public.app_users
      where id = auth.uid() and role = 'ENTRY'
    )
  );

-- PostgREST requires explicit DML grants in addition to RLS policies.
grant select, insert, update, delete on public.month_gate_override to authenticated;
