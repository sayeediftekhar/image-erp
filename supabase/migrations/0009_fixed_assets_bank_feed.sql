-- ============================================================================
-- IMAGE ERP — Migration 0009: fixed_assets + bank_feed (P1-T7)
-- Iron Laws: L1 (accumulated_depreciation = deterministic run, never hand-entered)
--            L3 (require_actor + audit trigger on both tables)
--            L4 (every row carries entity_id)
--            L5 (RLS entity-scoped; no authenticated write path — SELECT only)
-- Scope: schema + RLS + audit ONLY.
--   fixed_assets  — asset register, subsidiary ledger under GL control 1590
--   bank_feed     — independent bank-balance record; Phase 5 reconciles it
-- ============================================================================

-- ── fixed_assets ─────────────────────────────────────────────────────────────

create table public.fixed_assets (
  id                        uuid          primary key default gen_random_uuid(),
  entity_id                 uuid          not null references public.entities(id)       on delete restrict,
  name                      text          not null,
  -- FK to asset_classes (T3): the depreciation RATE lives with the class, not here.
  asset_class               text          not null references public.asset_classes(code) on delete restrict,
  purchase_date             date          not null,
  cost                      numeric(15,2) not null check (cost >= 0),
  -- Populated by the Phase 4 deterministic depreciation run (asset_class.annual_rate
  -- × cost, straight-line). NEVER written by an authenticated INSERT or hand-edited
  -- UPDATE. Phase 4 runs under service_role (BYPASSRLS) and is the sole writer.
  -- The sum of accumulated_depreciation across active assets for each entity
  -- must reconcile to GL control account 1590 (Accumulated Depreciation);
  -- that reconciliation check is a Phase 4 report, not enforced by a trigger here.
  accumulated_depreciation  numeric(15,2) not null default 0 check (accumulated_depreciation >= 0),
  active                    boolean       not null default true,
  created_by                uuid          not null default auth.uid(),
  created_at                timestamptz   not null default now(),
  updated_by                uuid,
  updated_at                timestamptz
);

create trigger trg_fixed_assets_actor
  before insert on public.fixed_assets
  for each row execute function app.require_actor();

create trigger trg_fixed_assets_touch
  before update on public.fixed_assets
  for each row execute function app.touch_updated();

create trigger trg_fixed_assets_audit
  after insert or update or delete on public.fixed_assets
  for each row execute function audit.log_change();

create index idx_fixed_assets_entity_id   on public.fixed_assets(entity_id);
create index idx_fixed_assets_asset_class on public.fixed_assets(asset_class);

-- ── bank_feed ─────────────────────────────────────────────────────────────────

create table public.bank_feed (
  id                uuid          primary key default gen_random_uuid(),
  entity_id         uuid          not null references public.entities(id)   on delete restrict,
  -- The GL bank account this statement balance is for (e.g. 1110 SJIB Current).
  account_code      text          not null references public.accounts(code) on delete restrict,
  statement_date    date          not null,
  -- What the bank says, independent of the ledger. Negative = overdrawn account.
  statement_balance numeric(15,2) not null,
  -- Originating SMS/row id from the import pipeline. Nullable: manual rows have none.
  source_ref        text,
  source_module     text          not null default 'SMS_FEED',
  created_by        uuid          not null default auth.uid(),
  created_at        timestamptz   not null default now(),
  updated_by        uuid,
  updated_at        timestamptz
);

-- Dedup guard: the same SMS message cannot be imported twice.
-- Partial index (WHERE source_ref IS NOT NULL) so multiple rows with source_ref=NULL
-- (manual / test inserts with no pipeline source) are never blocked by this constraint.
create unique index uidx_bank_feed_account_source_ref
  on public.bank_feed(account_code, source_ref)
  where source_ref is not null;

create trigger trg_bank_feed_actor
  before insert on public.bank_feed
  for each row execute function app.require_actor();

create trigger trg_bank_feed_touch
  before update on public.bank_feed
  for each row execute function app.touch_updated();

create trigger trg_bank_feed_audit
  after insert or update or delete on public.bank_feed
  for each row execute function audit.log_change();

create index idx_bank_feed_entity_id         on public.bank_feed(entity_id);
create index idx_bank_feed_account_stmt_date on public.bank_feed(account_code, statement_date);

-- ── RLS (Law 5) — entity-scoped, identical pattern to journal_entries ─────────

alter table public.fixed_assets enable row level security;
alter table public.bank_feed    enable row level security;

-- READ: ENTRY sees only their own entity; oversight roles see all.
-- bank_feed is readable by managers so they can see their clinic's bank balance
-- and not issue cheques blind against the book/bank position. Reconciliation
-- (signing off book = bank) is a Phase 5 HQ action, not a permission here.
create policy fixed_assets_read on public.fixed_assets
  for select to authenticated
  using (
    app.current_role() in ('ADMIN', 'HQ_FINANCE', 'READ_ONLY')
    or entity_id = app.current_entity()
  );

create policy bank_feed_read on public.bank_feed
  for select to authenticated
  using (
    app.current_role() in ('ADMIN', 'HQ_FINANCE', 'READ_ONLY')
    or entity_id = app.current_entity()
  );

-- SELECT only. No INSERT / UPDATE / DELETE granted to authenticated.
-- fixed_assets is written by the admin/service path (T8 admin panel for new
-- asset entry; Phase 4 depreciation run for accumulated_depreciation updates).
-- bank_feed is written by the Phase 5 SMS import pipeline.
-- Both service paths run under service_role (BYPASSRLS). Managers never write.
grant select on public.fixed_assets to authenticated;
grant select on public.bank_feed    to authenticated;
