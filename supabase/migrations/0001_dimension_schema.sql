-- ============================================================================
-- IMAGE ERP — Migration 0001: Dimension schema (P1-T1)
-- Tables: entities, accounts, parties  (+ app_users role mapping for RLS)
-- Scope: structure, CHECK constraints, audit columns, deactivate flag, RLS.
-- Deferred to T4 (need journal_lines to know "is this used yet?"):
--   - account type/normal_balance "lock once used" trigger
--   - "no hard-delete if used" trigger
-- This file is production-correct for Supabase: it assumes auth.uid() and the
-- `authenticated` role exist. Local testing uses tests/00_local_supabase_shim.sql.
-- Iron Laws touched: L3 (audit: created_by never null), L5 (RLS on every table).
-- ============================================================================

-- ---------- helper schema -----------------------------------------------------
create schema if not exists app;

-- SYSTEM actor uuid: used as created_by for migration-time seeds (no auth.uid()).
-- Real writes carry the authenticated user; this exists only so seed rows have a
-- non-null actor and never masquerade as a real person.
-- 00000000-0000-0000-0000-000000000000

-- ---------- enums -------------------------------------------------------------
create type account_type   as enum ('ASSET','LIABILITY','FUND','INCOME','EXPENSE');
create type normal_balance as enum ('DEBIT','CREDIT');
create type fund           as enum ('PI','RDF','HQ','TB_CARE');
create type party_kind     as enum ('VENDOR','DEBTOR','INSTRUMENT','COUNTERPARTY');
create type app_role       as enum ('ADMIN','HQ_FINANCE','ENTRY','READ_ONLY');

-- ---------- entities ----------------------------------------------------------
-- The 6 reporting units (5 clinics + HQ). Codes are NOT hard-constrained to the
-- current six: Blueprint §8 allows adding clinics. Uniqueness is enforced; the
-- known six are seeded below.
create table public.entities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (char_length(code) between 2 and 10),
  name        text not null,
  active      boolean not null default true,
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz
);

-- ---------- accounts (chart of accounts) -------------------------------------
-- code is the primary key: human-readable, stable, the thing you never rewrite.
-- normal_balance is STORED separately from type on purpose, so a contra-asset
-- (1590 Accumulated Depreciation = type ASSET, normal_balance CREDIT) is
-- expressible. fund is NULLABLE for the "any/—" accounts in Blueprint §3.
create table public.accounts (
  code            text primary key check (char_length(code) between 3 and 12),
  name            text not null,
  type            account_type   not null,
  normal_balance  normal_balance not null,
  fund            fund,                       -- null = applies to any fund
  is_control      boolean not null default false,
  active          boolean not null default true,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_at      timestamptz
);

-- ---------- parties (vendors, debtors, instruments, counterparties) ----------
-- Each party rolls up to a control account (AP 2010, Receivable 1310,
-- Investments 1520, Inter-clinic 1410/2210). control_account is RESTRICT so a
-- referenced control account cannot be deleted out from under its subsidiaries.
create table public.parties (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  kind            party_kind not null,
  control_account text references public.accounts(code) on delete restrict,
  contact         text,
  active          boolean not null default true,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_at      timestamptz
);

-- ---------- app_users (role mapping that drives RLS) -------------------------
-- On Supabase, id = auth.users.id. ENTRY users are scoped to one clinic;
-- ADMIN / HQ_FINANCE / READ_ONLY are cross-entity (entity_id null).
create table public.app_users (
  id          uuid primary key,
  full_name   text,
  role        app_role not null,
  entity_id   uuid references public.entities(id) on delete restrict,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  -- an ENTRY (clinic manager) MUST be tied to exactly one clinic;
  -- cross-entity roles MUST NOT carry an entity scope.
  constraint entry_user_has_entity check (
    (role = 'ENTRY'     and entity_id is not null) or
    (role <> 'ENTRY'    and entity_id is null)
  )
);

-- ---------- audit actor guard (Law 3: actor never null) ----------------------
-- Rejects any insert where neither an explicit created_by nor auth.uid() is
-- present. Seeds pass the SYSTEM uuid explicitly, so they're allowed.
create or replace function app.require_actor()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    raise exception 'created_by is null and no authenticated actor (auth.uid()) — write rejected (Iron Law 3)';
  end if;
  return new;
end $$;

-- ---------- updated_at / updated_by touch on UPDATE --------------------------
create or replace function app.touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

create trigger trg_entities_actor before insert on public.entities
  for each row execute function app.require_actor();
create trigger trg_entities_touch  before update on public.entities
  for each row execute function app.touch_updated();

create trigger trg_accounts_actor before insert on public.accounts
  for each row execute function app.require_actor();
create trigger trg_accounts_touch  before update on public.accounts
  for each row execute function app.touch_updated();

create trigger trg_parties_actor before insert on public.parties
  for each row execute function app.require_actor();
create trigger trg_parties_touch  before update on public.parties
  for each row execute function app.touch_updated();

-- ---------- role helpers (SECURITY DEFINER to avoid RLS recursion) -----------
create or replace function app.current_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from public.app_users where id = auth.uid() and active;
$$;

create or replace function app.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'ADMIN' from public.app_users where id = auth.uid() and active), false);
$$;

create or replace function app.current_entity()
returns uuid language sql stable security definer set search_path = public as $$
  select entity_id from public.app_users where id = auth.uid() and active;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Reference data (entities/accounts/parties) is shared config: every active
-- authenticated user may READ it; only ADMIN may write it ("Sayeed is the only
-- person who changes system logic"). Hard entity-scoping of FINANCIAL records
-- lands on journal_entries/journal_lines in T4 — these reference tables are not
-- entity-private, and scoping them buys no security while breaking lookups.
-- ============================================================================
alter table public.entities  enable row level security;
alter table public.accounts  enable row level security;
alter table public.parties   enable row level security;
alter table public.app_users enable row level security;

-- entities
create policy entities_read  on public.entities for select to authenticated using (true);
create policy entities_write on public.entities for all    to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- accounts
create policy accounts_read  on public.accounts for select to authenticated using (true);
create policy accounts_write on public.accounts for all    to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- parties
create policy parties_read  on public.parties for select to authenticated using (true);
create policy parties_write on public.parties for all    to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- app_users: a user sees their own row; ADMIN sees/writes all.
create policy app_users_self_read on public.app_users for select to authenticated
  using (id = auth.uid() or app.is_admin());
create policy app_users_admin_write on public.app_users for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- table privileges (RLS filters on top of these)
grant select, insert, update, delete on public.entities  to authenticated;
grant select, insert, update, delete on public.accounts  to authenticated;
grant select, insert, update, delete on public.parties   to authenticated;
grant select, insert, update, delete on public.app_users to authenticated;

-- ============================================================================
-- SEED: the six entities (settled reference data). Seeded with the SYSTEM actor
-- because there is no auth.uid() at migration time.
-- ============================================================================
insert into public.entities (code, name, created_by) values
  ('JAL','Jalalabad', '00000000-0000-0000-0000-000000000000'),
  ('NAS','Nasirabad', '00000000-0000-0000-0000-000000000000'),
  ('AMB','Amanbazar', '00000000-0000-0000-0000-000000000000'),
  ('KAT','Kattali',   '00000000-0000-0000-0000-000000000000'),
  ('CHA','Chandgaon', '00000000-0000-0000-0000-000000000000'),
  ('HQ', 'Head Office','00000000-0000-0000-0000-000000000000');
