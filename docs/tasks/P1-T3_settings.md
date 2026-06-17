# Task Spec — P1-T3: settings + asset_classes (config & seed)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

## Problem (one sentence)

The system needs adjustable config — capitalisation threshold, fiscal year, the
high-value approval threshold, and the §7 asset-class depreciation rates — held as
editable data (Blueprint §8), not hard-coded.

## Output contract

One migration `supabase/migrations/0003_settings_and_asset_classes.sql`:

### Table 1 — `public.settings` (key-value scalars)

- `key text primary key`
- `value jsonb not null` (jsonb numbers are exact NUMERIC internally — no float risk)
- `description text` (so the admin panel can explain each setting)
- audit columns: `created_by uuid not null default auth.uid()`, `created_at`,
  `updated_by`, `updated_at` — same shape as T1 tables.
- Attach `app.require_actor()` (BEFORE INSERT) and `app.touch_updated()` (BEFORE UPDATE).

### Table 2 — `public.asset_classes` (the §7 rates, as typed data)

- `code text primary key` (FURNITURE / MEDICAL / IT / VEHICLE / BUILDING / RENOVATION)
- `name text not null`
- `useful_life_years int not null check (useful_life_years > 0)`
- `annual_rate numeric(6,4) not null check (annual_rate > 0 and annual_rate <= 1)`
  — stored as a FRACTION (0.1000 = 10%), so depreciation = cost × annual_rate directly.
- `residual_rate numeric(6,4) not null default 0 check (residual_rate >= 0 and residual_rate < 1)`
- `active boolean not null default true`
- audit columns (same as above) + `require_actor` + `touch_updated` triggers.

### Generalise the audit trigger (replaces the accounts special-case)

- `CREATE OR REPLACE FUNCTION audit.log_change()` (append-only-correct: new migration,
  not an edit to 0002). Keep everything else identical; change ONLY record_id resolution to:
    ```
    v_rec := coalesce(to_jsonb(NEW), to_jsonb(OLD));
    v_record_id := coalesce(v_rec->>'id', v_rec->>'code', v_rec->>'key');
    ```
    This covers uuid-id tables, accounts(code), settings(key), asset_classes(code) with
    no per-table branching. Remove the `TG_TABLE_NAME = 'accounts'` branch.
- Attach the audit trigger (AFTER INSERT/UPDATE/DELETE) to `settings` and `asset_classes`.

### RLS (Law 5) — same pattern as T1 reference tables

- Enable RLS on both. SELECT: all authenticated (`using (true)`). Write (ALL):
  `using (app.is_admin()) with check (app.is_admin())`.
- `grant select, insert, update, delete on public.settings, public.asset_classes to authenticated;`

### Seed (with SYSTEM actor `00000000-0000-0000-0000-000000000000`)

`settings`:

- `capitalisation_threshold` = `10000` — "Minimum cost (BDT) to capitalise vs expense an asset"
- `fiscal_year_start_month` = `7` — "Month the fiscal year begins (1-12); Bangladesh standard July" (Sayeed to confirm)
- `high_value_approval_threshold` = `50000` — "Entry total (BDT) above which maker-checker approval is required (PROVISIONAL — confirm at pilot; GitHub issue #2)"

`asset_classes` (Blueprint §7, residual_rate 0 for all):
| code | name | useful_life_years | annual_rate |
|---|---|---|---|
| FURNITURE | Furniture & Fixtures | 10 | 0.1000 |
| MEDICAL | Medical / Lab Equipment | 7 | 0.1500 |
| IT | Computer / IT Equipment | 4 | 0.2500 |
| VEHICLE | Vehicles | 5 | 0.2000 |
| BUILDING | Building (structure) | 20 | 0.0500 |
| RENOVATION | Renovation / Leasehold Improvements | 10 | 0.1000 |

## Relevant files (read before write)

- `supabase/migrations/0001_dimension_schema.sql` (audit-column pattern, require_actor, touch, RLS pattern)
- `supabase/migrations/0002_audit_log.sql` (the audit.log_change() function being replaced)
- `supabase/tests/00_local_supabase_shim.sql`, `CONTEXT.md`, `LEARNINGS.md`

## Iron Laws in play

- L3 — settings/asset_classes writes are attributed and audited (require_actor + audit trigger).
- L5 — RLS on both new tables, tested per role.

## Applicable LEARNINGS

- RLS blocks UPDATE/DELETE silently (assert row unchanged, don't expect an error)
  for the grant-present/RLS-filtered case.
- Migrations are append-only — replace the trigger via CREATE OR REPLACE in 0003, never edit 0002.
- Seeds have no auth.uid() — pass the SYSTEM uuid explicitly or require_actor rejects them.
- jsonb numbers are exact; read with `(value->>'x')::numeric` and Zod-parse (NUMERIC → string in JS).

## Done-criteria (the test `0003_..._test.sql` must prove)

1. 3 settings + 6 asset_classes seeded with exact values (spot-check annual_rate of a couple).
2. ADMIN can write both tables; ENTRY can read but not write (RLS matrix).
3. The generalised audit trigger logs an insert/update to `settings` with record_id = the
   `key`, and to `asset_classes` with record_id = the `code` — proving generic resolution.
4. require_actor rejects a null-actor write; touch trigger stamps updated_by/updated_at.
5. Full regression: 0001 (21) + 0002 (20) still green — confirm the generalised trigger still
   yields record_id = code for accounts and = id for uuid tables.

## On completion

End with exactly one status: DONE (evidence) / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT.
Bring the diff + status back to the Architect for Iron-Law review.
