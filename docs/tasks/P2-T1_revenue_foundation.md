# Task Spec — P2-T1: Statistics store + revenue-day submission record (schema only)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: the BACKEND FOUNDATION for the manager revenue entry — two tables and their
> RLS/constraints/audit. NO submit logic (that's P2-T2), NO UI (P2-T3+), NO posting-engine
> changes. This task lays the schema the entry forms will write to and the submit service will
> read from. Migration only (+ test), same discipline as P1-T4.

## Problem (one sentence)

The revenue entry needs two persistence homes that don't exist yet: a `daily_activity` statistics
store (the COUNTS — long/tidy, per Mapping §5) and a `revenue_day` submission record (the day's
captured entry, its DRAFT→SUBMITTED lifecycle, owning its detail as JSON while draft, linking to
the ledger via source_module/source_id on submit — per Mapping §0 "one entry, two destinations"
and the Phase-0 control-account/module-boundary pattern).

## Reference

- `docs/.../Phase2_Revenue_Mapping_v2.md` — §0 (two destinations), §4/§5 (stats grain, long/tidy),
  §0b (funds). THE design source for this task.
- `supabase/migrations/0004_ledger_core.sql` — journal_entries pattern (status enum, source_module/
  source_id columns, require_actor, touch, audit trigger, entity-scoped RLS). MIRROR these patterns.
- `CONTEXT.md`, `LEARNINGS.md`.

## Output contract

One migration `supabase/migrations/0011_revenue_entry_foundation.sql` + test
`supabase/tests/0011_revenue_entry_foundation_test.sql`.

### Table 1 — `public.daily_activity` (the statistics store — COUNTS only)

Long/tidy, one row per (entity, date, channel, service, metric) → value. Per Mapping §5.

- `id uuid primary key default gen_random_uuid()`
- `entity_id uuid not null references public.entities(id) on delete restrict`
- `activity_date date not null` — the economic date (the day the activity happened)
- `channel text not null` — MORNING / EVENING / AFTERHOURS / STATIC / TEAM_1 / TEAM_2 / …
- `service text not null` — OUTDOOR / LAB / USG_LOWER / USG_WHOLE / USG_PP / USG_ANOMALY / NVD / CSECTION / …
- `metric text not null` — patients_new / patients_old / services / lab_tests / usg_count / cases / …
- `value numeric(15,2) not null default 0` — the count (numeric to allow any metric; counts are whole, but keep numeric for generality)
- `source text not null default 'MANUAL_AGGREGATE'` — MANUAL_AGGREGATE vs (future) SYSTEM_DERIVED — the seam for future patient modules
- `revenue_day_id uuid` — FK set in P2-T2 to the revenue_day that produced this row (nullable now; the column exists so submit can link). reference public.revenue_day(id) on delete cascade — see note.
- audit columns: `created_by uuid not null default auth.uid()`, `created_at`, `updated_by`, `updated_at`
- `require_actor` BEFORE INSERT, `touch_updated` BEFORE UPDATE, audit trigger AFTER I/U/D.
- **Unique constraint** on (entity_id, activity_date, channel, service, metric) — one value per
  cell; re-submitting a day replaces rather than duplicates (the submit service in P2-T2 will rely
  on this for idempotent upsert).
- Index on (entity_id, activity_date) for report queries.

### Table 2 — `public.revenue_day` (the submission record + draft lifecycle)

One row per (entity, date) revenue entry. Owns the day's captured detail as JSON while DRAFT;
on SUBMIT (P2-T2) it produces journal entries + daily_activity rows and links to them.

- `id uuid primary key default gen_random_uuid()`
- `entity_id uuid not null references public.entities(id) on delete restrict`
- `revenue_date date not null` — the day this entry is for (economic date)
- `status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED'))`
  — DRAFT = staged form data, nothing posted. SUBMITTED = engine fired + stats written.
  (Only these two for now; a future 'VOID'/correction path is out of scope.)
- `draft_data jsonb` — the captured form state while DRAFT (flexible:
  handles per-clinic variation + dynamic satellite teams without rigid columns). On SUBMIT
  this is the source the submit service reads to produce ledger + stats. Kept after submit as
  the record of what was entered (the "view a submitted day" screen reads a clean projection).
- `journal_entry_id uuid references public.journal_entries(id) on delete restrict`
  — set on SUBMIT (P2-T2): the summarized journal entry this day posted. Null while DRAFT.
- `total_revenue numeric(15,2)` — the day's computed total (a convenience/check figure;
  authoritative money is the ledger. Stored for the management-page list + report speed.)
- `submitted_at timestamptz` — when it was submitted (null while draft).
- `entered_at timestamptz not null default now()` — server clock (lateness/backdating detector,
  same rationale as journal_entries.entered_at — managers batch-enter days late).
- audit columns + `require_actor` + `touch_updated` + audit trigger (same as every table).
- **Unique constraint** on (entity_id, revenue_date) — one revenue-day record per clinic per date
  (a day is entered once; re-opening edits the same record).

> **Ordering note (FK between the two tables):** `daily_activity.revenue_day_id` references
> `revenue_day(id)`. Create `revenue_day` FIRST in the migration, then `daily_activity`, so the FK
> resolves. (Or add the FK after both exist.) Choose the clean ordering and note it.

### RLS (Law 5) — entity-scoped, mirroring journal_entries

- Enable RLS on both tables.
- **READ:** ENTRY sees only their own entity (`entity_id = app.current_entity()`); ADMIN /
  HQ_FINANCE / READ_ONLY see all. (Same shape as journal_entries READ in 0004.)
- **WRITE (this is the key difference from the ledger):** unlike journal_lines (engine-only, no
  authenticated write), here the **ENTRY manager IS the writer of their own draft** — they create
  and edit their revenue_day draft and its (eventual) data directly. So:
    - `revenue_day`: ENTRY may INSERT/UPDATE rows for THEIR OWN entity
      (`entity_id = app.current_entity()`), in DRAFT status. ADMIN all.
    - **Important question for the plan:** should ENTRY be allowed to write `daily_activity`
      directly, or is `daily_activity` written ONLY by the submit service (server-side)? RECOMMEND:
      `daily_activity` is written by the SUBMIT service (server-side, like the posting engine), NOT
      directly by the manager's draft edits — because stats should only become real on submit, in
      lockstep with the ledger. So `daily_activity` gets NO authenticated write (engine/service
      writes it via service_role), same as journal_lines. The DRAFT lives in `revenue_day.draft_data`
      (which the manager CAN write); `daily_activity` rows appear only at submit. Confirm this split
      in the plan.
- Grants accordingly: `revenue_day` — select+insert+update to authenticated (RLS scopes it);
  `daily_activity` — select only to authenticated (writes via service_role in P2-T2).

### Constraints / integrity

- The DRAFT→SUBMITTED transition direction (can't go SUBMITTED→DRAFT) — RECOMMEND a guard
  (trigger or check) so a submitted day isn't silently reverted. Discuss in plan; may defer the
  hard guard to P2-T2 where submit logic lives (note the choice).
- `total_revenue`, `value` etc. — `numeric(15,2)`, never float (Law: money/integers exact).

## Iron Laws in play

- L1 — figures are data the manager enters / the engine computes; nothing here generates a number
  by inference.
- L3 — both tables fully attributed (require_actor) + audited (audit trigger).
- L4 — every row carries an entity; (fund lives on the journal lines produced at submit, and on the
  daily_activity service/channel mapping — fund resolution is at submit/report time, not stored on
  daily_activity rows unless the plan finds it necessary — discuss).
- L5 — RLS entity-scoped + the manager-writes-own-draft vs service-writes-stats split, tested per role.

## Applicable LEARNINGS

- Mirror journal_entries: status enum, source_module/source_id linkage, entered_at server clock,
  require_actor/touch/audit triggers, entity-scoped RLS.
- RLS blocks UPDATE/DELETE silently (assert row unchanged) where grant present; NO write grant →
  permission denied (expect_fail) — daily_activity has no authenticated write, so its denial is the
  privilege-layer kind.
- Seeds/tests with no auth.uid() need the SYSTEM uuid.
- gen_random_uuid available; numeric returns strings in JS (Zod transform later, in the UI tasks).

## Done-criteria (the test must prove)

1. Both tables exist with the columns/constraints above; the (entity,date,channel,service,metric)
   unique on daily_activity and (entity,revenue_date) unique on revenue_day enforce.
2. An ENTRY (JAL) user can INSERT/UPDATE a revenue_day for JAL in DRAFT; CANNOT for NAS (RLS);
   CANNOT write daily_activity at all (no grant — permission denied).
3. ADMIN can read all revenue_day/daily_activity; ENTRY sees only their entity's rows.
4. require_actor rejects null-actor writes; audit rows written on insert/update; touch stamps update.
5. status check rejects an invalid status; (if the direction guard is included) SUBMITTED→DRAFT
   is rejected.
6. Full regression: prior migrations (0001–0010) still green.

## On completion

End with exactly one status — do NOT commit; Architect review + Sayeed verify, then commit + push +
`supabase db push`. Next: **P2-T2 — the submit service** (read a SUBMITTED revenue_day's draft_data
→ post ONE summarized journal entry via the existing posting engine with source_module='REVENUE_ENTRY',
source_id=revenue_day.id → write daily_activity rows → all in one transaction). Then P2-T3+ the UI.
