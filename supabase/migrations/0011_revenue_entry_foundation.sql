-- ============================================================================
-- IMAGE ERP — Migration 0011: Revenue entry foundation (P2-T1)
-- Tables: revenue_day (submission record + DRAFT→SUBMITTED lifecycle) +
--         daily_activity (statistics store — long/tidy counts, Mapping §5)
-- Iron Laws:
--   L1 — figures are data-entered or engine-computed; none inferred here.
--   L3 — require_actor + audit trigger on both tables; actor never null.
--   L4 — every row carries entity_id.
--   L5 — RLS: ENTRY writes own DRAFT revenue_day; daily_activity is
--         SELECT-only to authenticated (sole writer = P2-T2 via service_role,
--         same pattern as journal_lines).
--
-- FK ordering: revenue_day first (refs entities + journal_entries — both exist);
--   daily_activity second (refs revenue_day — now exists in this migration).
--
-- Not in this migration: submit logic (P2-T2), UI (P2-T3+), changes to
--   journal_entries / journal_lines, or the posting engine.
-- ============================================================================

-- ---------- public.revenue_day -----------------------------------------------
create table public.revenue_day (
  id               uuid          primary key default gen_random_uuid(),
  entity_id        uuid          not null references public.entities(id) on delete restrict,
  revenue_date     date          not null,
  status           text          not null default 'DRAFT'
                                 check (status in ('DRAFT','SUBMITTED')),
  -- All captured form state while DRAFT; retained after submit (audit record of
  -- exactly what was entered; source for the "view submitted day" screen).
  draft_data       jsonb,
  -- Null while DRAFT. Set by the P2-T2 submit service on posting.
  -- Reverse link on journal_entries: source_module='REVENUE_ENTRY', source_id=revenue_day.id.
  journal_entry_id uuid          references public.journal_entries(id) on delete restrict,
  -- Convenience check figure (sum of income lines); null while DRAFT.
  -- Authoritative money is the ledger — this never drives accounting decisions.
  total_revenue    numeric(15,2),
  submitted_at     timestamptz,
  -- Server clock: lateness/backdating detector. Managers batch-enter days late;
  -- entered_at ≠ revenue_date flags the gap (same rationale as journal_entries.entered_at).
  entered_at       timestamptz   not null default now(),
  created_by       uuid          not null default auth.uid(),
  created_at       timestamptz   not null default now(),
  updated_by       uuid,
  updated_at       timestamptz,
  -- One entry per clinic per date. A day is entered once; re-opening edits this row.
  unique (entity_id, revenue_date)
);

create trigger trg_revenue_day_actor before insert on public.revenue_day
  for each row execute function app.require_actor();
create trigger trg_revenue_day_touch  before update on public.revenue_day
  for each row execute function app.touch_updated();

-- SUBMITTED is terminal: it cannot be reverted to any other status.
-- Analogous to T4b block_posted_mutation on journal_entries.
-- Does NOT block: DRAFT→SUBMITTED (old.status='DRAFT'); non-status field updates
-- on SUBMITTED rows (new.status='SUBMITTED'=old.status). P2-T2 submit service
-- runs as service_role (BYPASSRLS) but triggers always fire — DRAFT→SUBMITTED
-- has old.status='DRAFT', so the guard condition is never true for that path.
create or replace function app.block_revenue_day_revert()
returns trigger language plpgsql as $$
begin
  if old.status = 'SUBMITTED' and new.status <> 'SUBMITTED' then
    raise exception
      'revenue_day % is SUBMITTED — status cannot be reverted', old.id;
  end if;
  return new;
end $$;

create trigger trg_revenue_day_submitted_lock
  before update on public.revenue_day
  for each row execute function app.block_revenue_day_revert();

create trigger trg_revenue_day_audit
  after insert or update or delete on public.revenue_day
  for each row execute function audit.log_change();

-- ---------- public.daily_activity (statistics store) -------------------------
-- Sole writer: P2-T2 submit service (service_role, BYPASSRLS) — same discipline
-- as journal_lines. Stats appear only at submit time, never as draft state.
create table public.daily_activity (
  id             uuid          primary key default gen_random_uuid(),
  entity_id      uuid          not null references public.entities(id) on delete restrict,
  activity_date  date          not null,
  channel        text          not null,  -- MORNING / EVENING / AFTERHOURS / STATIC / TEAM_n
  service        text          not null,  -- OUTDOOR / LAB / USG_* / NVD / CSECTION / …
  metric         text          not null,  -- patients_new/old / services / lab_tests / usg_count / cases / …
  value          numeric(15,2) not null default 0,
  -- MANUAL_AGGREGATE (now) vs SYSTEM_DERIVED (future patient modules). Mirrors the
  -- source_module seam on journal_entries; when patient records exist, counts can be
  -- derived and the flag distinguishes manual-aggregate from system-computed values.
  source         text          not null default 'MANUAL_AGGREGATE',
  -- Linked by P2-T2 at submit to the revenue_day that produced this row.
  -- Null until submit. On delete cascade: voiding a revenue_day removes its stats.
  revenue_day_id uuid          references public.revenue_day(id) on delete cascade,
  created_by     uuid          not null default auth.uid(),
  created_at     timestamptz   not null default now(),
  updated_by     uuid,
  updated_at     timestamptz,
  -- One value per cell. P2-T2 relies on this for idempotent ON CONFLICT upsert.
  unique (entity_id, activity_date, channel, service, metric)
);

-- Primary report-query key: all stat reads filter by entity + date.
create index on public.daily_activity (entity_id, activity_date);

create trigger trg_daily_activity_actor before insert on public.daily_activity
  for each row execute function app.require_actor();
create trigger trg_daily_activity_touch  before update on public.daily_activity
  for each row execute function app.touch_updated();
create trigger trg_daily_activity_audit
  after insert or update or delete on public.daily_activity
  for each row execute function audit.log_change();

-- ---------- RLS (Law 5) -------------------------------------------------------
alter table public.revenue_day    enable row level security;
alter table public.daily_activity enable row level security;

-- revenue_day READ: oversight roles see all; ENTRY is entity-scoped.
create policy revenue_day_read on public.revenue_day
  for select to authenticated
  using (
    app.current_role() in ('ADMIN','HQ_FINANCE','READ_ONLY')
    or entity_id = app.current_entity()
  );

-- revenue_day ENTRY INSERT: own entity only; status must be DRAFT.
-- ENTRY cannot create SUBMITTED rows directly; the submit service uses service_role.
create policy revenue_day_entry_insert on public.revenue_day
  for insert to authenticated
  with check (
    app.current_role() = 'ENTRY'
    and entity_id = app.current_entity()
    and status = 'DRAFT'
  );

-- revenue_day ENTRY UPDATE: own DRAFT rows only (USING); result must remain DRAFT (WITH CHECK).
-- USING: SUBMITTED rows are invisible to ENTRY updates → 0 rows affected, no error.
-- WITH CHECK: prevents ENTRY from flipping status to SUBMITTED via this path.
-- P2-T2 submit service runs as service_role (BYPASSRLS) and bypasses both clauses.
create policy revenue_day_entry_update on public.revenue_day
  for update to authenticated
  using (
    app.current_role() = 'ENTRY'
    and entity_id = app.current_entity()
    and status = 'DRAFT'
  )
  with check (
    app.current_role() = 'ENTRY'
    and entity_id = app.current_entity()
    and status = 'DRAFT'
  );

-- revenue_day ADMIN: full access — all entities, all statuses.
create policy revenue_day_admin_write on public.revenue_day
  for all to authenticated
  using  (app.is_admin())
  with check (app.is_admin());

-- daily_activity READ: same entity-scoped shape as revenue_day read.
-- No write policy for authenticated — any authenticated write attempt fails at the
-- privilege layer ("permission denied"), not silently via RLS. Same as journal_lines.
create policy daily_activity_read on public.daily_activity
  for select to authenticated
  using (
    app.current_role() in ('ADMIN','HQ_FINANCE','READ_ONLY')
    or entity_id = app.current_entity()
  );

-- Grants -----------------------------------------------------------------------
-- revenue_day: SELECT + INSERT + UPDATE (RLS restricts who can do what).
--   No DELETE grant — any future discard path is service_role territory.
-- daily_activity: SELECT only — authenticated INSERT/UPDATE/DELETE → "permission denied",
--   not a silent 0-row result. Distinction matters for test assertions (expect_fail).
grant select, insert, update on public.revenue_day    to authenticated;
grant select                  on public.daily_activity to authenticated;
