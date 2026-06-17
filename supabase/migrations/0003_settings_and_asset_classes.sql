-- ============================================================================
-- IMAGE ERP — Migration 0003: settings + asset_classes (P1-T3)
-- Tables: public.settings (key-value scalars), public.asset_classes (§7 rates)
-- Also replaces audit.log_change() with the generic id>code>key PK resolver.
-- Iron Laws: L3 (require_actor + audit trigger on both tables), L5 (RLS)
-- ============================================================================

-- ---------- public.settings --------------------------------------------------
create table public.settings (
  key          text        primary key,
  value        jsonb       not null,
  description  text,
  created_by   uuid        not null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz
);

create trigger trg_settings_actor before insert on public.settings
  for each row execute function app.require_actor();
create trigger trg_settings_touch  before update on public.settings
  for each row execute function app.touch_updated();

-- ---------- public.asset_classes ---------------------------------------------
create table public.asset_classes (
  code               text          primary key,
  name               text          not null,
  useful_life_years  int           not null  check (useful_life_years > 0),
  annual_rate        numeric(6,4)  not null  check (annual_rate > 0 and annual_rate <= 1),
  residual_rate      numeric(6,4)  not null  default 0
                                             check (residual_rate >= 0 and residual_rate < 1),
  active             boolean       not null  default true,
  created_by         uuid          not null  default auth.uid(),
  created_at         timestamptz   not null  default now(),
  updated_by         uuid,
  updated_at         timestamptz
);

create trigger trg_asset_classes_actor before insert on public.asset_classes
  for each row execute function app.require_actor();
create trigger trg_asset_classes_touch  before update on public.asset_classes
  for each row execute function app.touch_updated();

-- ---------- generalised audit.log_change() (replaces 0002 version) ----------
-- CREATE OR REPLACE updates the function body in-place. All existing triggers
-- on entities, accounts, parties, app_users automatically use the new body;
-- no drop-and-recreate of those triggers is needed.
create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = public, audit, auth
as $$
declare
  _record_id  text;
  _actor      uuid;
  _old_json   jsonb;
  _new_json   jsonb;
  _v_rec      jsonb;
  _system     constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- Capture row snapshots via explicit branches — NEW is undefined on DELETE,
  -- OLD is undefined on INSERT; never call to_jsonb() on an undefined record.
  if TG_OP = 'INSERT' then
    _old_json := null;
    _new_json := to_jsonb(new);
  elsif TG_OP = 'DELETE' then
    _old_json := to_jsonb(old);
    _new_json := null;
  else  -- UPDATE
    _old_json := to_jsonb(old);
    _new_json := to_jsonb(new);
  end if;

  -- Generic PK resolver: id → code → key, in priority order.
  -- Covers all attached tables with no per-table branching:
  --   id   → entities, parties, app_users  (uuid PK)
  --   code → accounts, asset_classes       (text PK)
  --   key  → settings                      (text PK)
  -- entities has both id (uuid PK) and code ('JAL' etc.); id wins correctly.
  _v_rec     := coalesce(_new_json, _old_json);
  _record_id := coalesce(_v_rec->>'id', _v_rec->>'code', _v_rec->>'key');

  -- Actor resolution uses jsonb extraction throughout — never direct NEW.column
  -- references. app_users has no created_by/updated_by columns; a direct field
  -- access like NEW.created_by would raise a runtime error on that table.
  -- jsonb->>'field' returns null for absent fields, so this works uniformly
  -- across all tables without any per-table branching.
  if TG_OP = 'INSERT' then
    _actor := coalesce(
      auth.uid(),
      (_new_json->>'created_by')::uuid,
      _system
    );
  elsif TG_OP = 'UPDATE' then
    _actor := coalesce(
      auth.uid(),
      (_new_json->>'updated_by')::uuid,
      (_new_json->>'created_by')::uuid,
      (_old_json->>'updated_by')::uuid,
      _system
    );
  else  -- DELETE
    _actor := coalesce(
      auth.uid(),
      (_old_json->>'updated_by')::uuid,
      (_old_json->>'created_by')::uuid,
      _system
    );
  end if;

  insert into audit.audit_log (table_name, record_id, op, old_json, new_json, actor)
  values (TG_TABLE_NAME, _record_id, TG_OP, _old_json, _new_json, _actor);

  return null;  -- AFTER trigger; return value is ignored for row-level AFTER triggers
end $$;

-- ---------- attach audit triggers to new tables ------------------------------
create trigger trg_settings_audit
  after insert or update or delete on public.settings
  for each row execute function audit.log_change();

create trigger trg_asset_classes_audit
  after insert or update or delete on public.asset_classes
  for each row execute function audit.log_change();

-- ---------- RLS (same pattern as T1 reference tables) ------------------------
alter table public.settings      enable row level security;
alter table public.asset_classes enable row level security;

-- SELECT: all authenticated users can read config (needed for entry + reports).
-- Write: ADMIN only.
create policy settings_read  on public.settings for select to authenticated using (true);
create policy settings_write on public.settings for all    to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy asset_classes_read  on public.asset_classes for select to authenticated using (true);
create policy asset_classes_write on public.asset_classes for all    to authenticated
  using (app.is_admin()) with check (app.is_admin());

grant select, insert, update, delete on public.settings      to authenticated;
grant select, insert, update, delete on public.asset_classes to authenticated;

-- ============================================================================
-- SEED: settings (SYSTEM actor — no auth.uid() at migration time)
-- ============================================================================
insert into public.settings (key, value, description, created_by) values
  ('capitalisation_threshold',
   '10000',
   'Minimum cost (BDT) to capitalise vs expense an asset',
   '00000000-0000-0000-0000-000000000000'),

  ('fiscal_year_start_month',
   '7',
   'Month the fiscal year begins (1-12); Bangladesh standard July — PROVISIONAL, confirm with Sayeed at pilot',
   '00000000-0000-0000-0000-000000000000'),

  ('high_value_approval_threshold',
   '50000',
   'Entry total (BDT) above which maker-checker approval is required — PROVISIONAL, confirm at pilot (see open question in CONTEXT.md)',
   '00000000-0000-0000-0000-000000000000');

-- ============================================================================
-- SEED: asset_classes (Blueprint §7 rates; residual_rate = 0 for all)
-- ============================================================================
insert into public.asset_classes (code, name, useful_life_years, annual_rate, created_by) values
  ('FURNITURE',  'Furniture & Fixtures',                10, 0.1000, '00000000-0000-0000-0000-000000000000'),
  ('MEDICAL',    'Medical / Lab Equipment',              7, 0.1500, '00000000-0000-0000-0000-000000000000'),
  ('IT',         'Computer / IT Equipment',              4, 0.2500, '00000000-0000-0000-0000-000000000000'),
  ('VEHICLE',    'Vehicles',                             5, 0.2000, '00000000-0000-0000-0000-000000000000'),
  ('BUILDING',   'Building (structure)',                20, 0.0500, '00000000-0000-0000-0000-000000000000'),
  ('RENOVATION', 'Renovation / Leasehold Improvements', 10, 0.1000, '00000000-0000-0000-0000-000000000000');
