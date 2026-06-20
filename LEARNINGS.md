# IMAGE ERP — LEARNINGS.md

Durable quirks and facts. Add to this whenever something costs >5 min to rediscover.

## Discovered while building (newest first)
- **C-section discharge cash distortion (P2-T2b):** all C-section discharge cash routes to
  1010/PI as a deliberate simplification. The RDF income portions (4110/4130) do NOT carry
  matching RDF cash — a known PI/RDF fund-cash distortion deferred to Phase 4/5 to resolve
  against real data (touches the PI/RDF bank reconciliation). The posting engine enforces
  Σ Dr = Σ Cr overall (not per-fund), so the entry is valid; the distortion is visible at
  fund-level balance sheet. Do NOT rationalise this as "managers keep cash notionally as PI" —
  it is a structural simplification with a known seam.
- **pg driver returns PostgreSQL `date` columns as JS Date objects by default.** Cast to text
  in the SELECT: `revenue_date::text AS revenue_date`. This keeps `entryDate` as a
  `'YYYY-MM-DD'` string throughout the service and avoids `ZodError: Expected string, received
  date` at PostTransactionSchema.parse. The pattern: cast early, never convert in application code.
- **Next.js 14 does NOT support `next.config.ts` — TypeScript config is a Next.js 15
  feature.** Using `.ts` against an installed Next 14 throws "Configuring Next.js via
  next.config.ts is not supported" at dev start. Use `next.config.mjs` (ESM) or
  `next.config.js` (CJS) instead. Fixed by renaming to `.mjs` with the equivalent
  `export default {}` syntax.
- **Test seed users shared between the psql suite and the Jest suite must use
  `ON CONFLICT (id) DO UPDATE SET role=..., entity_id=..., active=...`, not
  `DO NOTHING`.** The `0001_dimension_schema_test.sql` psql test leaves UUIDs
  11111111–44444444 in `app_users` with specific roles (e.g. 33333333 = ENTRY/JAL,
  44444444 = READ_ONLY). A Jest `beforeAll` that re-inserts them with `DO NOTHING`
  silently keeps the stale psql-test role, so when the engine checks eligibility it
  sees the wrong role — the wrong guard fires (or doesn't), and the test
  passes/fails for the wrong reason. `DO UPDATE SET role=... entity_id=...` forces
  the intended role unconditionally regardless of prior DB state.
- **Migrations are append-only once committed — never edit a shipped migration.**
  Any fix or backfill belongs in the next migration file, not in the original.
  Local test infra (shim, test files) may be edited freely since they are never
  applied to production; migrations are. (Violated once in P1-T2 build; caught
  in review and corrected.)
- **The local shim's `auth.uid()` must null-guard before casting to jsonb.**
  `auth.logout()` stores `''` (empty string) in the `request.jwt.claims` GUC.
  `''::jsonb` throws "invalid input syntax for type json". Fix: wrap with
  `nullif(current_setting(...), '')::jsonb` so an empty setting becomes null
  instead of an error. (Bit P1-T2 in the SYSTEM-fallback actor test.)
- **Generic trigger functions shared across tables must use jsonb field access,
  not direct record-field access, for columns that only some tables have.**
  `new.created_by` in a trigger body raises a runtime error when the trigger
  fires on a table (e.g. `app_users`) that has no `created_by` column. Pattern:
  `to_jsonb(new) ->> 'created_by'` returns null silently for absent fields.
- **The local shim and T1 migration were missing USAGE grants on `auth` and
  `app` schemas for `authenticated`.** Supabase provides these automatically;
  local Postgres does not. `authenticated` needs USAGE on every schema whose
  objects it calls (including SECURITY DEFINER functions). Added: shim grants
  `auth` to `authenticated, anon`; T1 migration grants `app` to same.
  (The LEARNINGS note already said to do this; the implementation was absent.)
- **Append-only test pattern: when a grant is revoked, `expect_fail` is correct.
  `expect_ok`-then-assert-unchanged is only for the grant-present / RLS-filtered
  case** where the statement runs but the row is invisible. Direct
  INSERT/UPDATE/DELETE on `audit.audit_log` from `authenticated` fails at the
  privilege level (permission denied), not silently via RLS.
- **RLS blocks UPDATE/DELETE *silently* by filtering rows (0 rows, no error); only
  INSERT raises on WITH CHECK.** Test write-blocks by asserting the row was NOT
  changed, never by expecting an exception. (Cost a failed test on P1-T1.)
- **`created_by default auth.uid()`** works at the column-default level on both
  Supabase and a local shim. Migration-time seeds have no `auth.uid()`, so seed rows
  must pass the SYSTEM uuid `00000000-...-0000` explicitly, or the L3 actor guard
  rejects them.
- **Role helpers that policies call must be `SECURITY DEFINER`** (e.g. `app.is_admin()`
  reading `app_users`) or RLS on `app_users` recurses. They run as owner = bypass RLS.
- **Local Postgres can fully emulate Supabase RLS** via a shim: create roles
  `authenticated`/`anon`/`service_role`, an `auth.uid()` that reads the
  `request.jwt.claims` GUC, and `auth.login_as(uid)` to switch identity in tests.
  Grant `usage` on schemas `auth`/`app`/`test` to `authenticated` (Supabase does this
  for you; local doesn't).

## Accounting model
- Double-entry; ledger (journal_entries + journal_lines) = single source of truth.
- Basis: cash for most expenses; ACCRUAL for salaries, doctor fees & allowances.
- Four funds: PI · RDF · HQ-General · TB Care (restricted). Six entities: 5 clinics + HQ.
- RDF purchases → RDF Stock (asset), NOT expense. COGS monthly = Opening+Purch−Closing.
- `normal_balance` is stored separately from `type` so contra-asset 1590 (Accumulated
  Depreciation) = type ASSET + normal_balance CREDIT. Don't derive one from the other.
- `account.fund` is NULLABLE — the "any/—" accounts in Blueprint §3 apply to any fund;
  the line's fund is resolved at posting time (T4/T5).
- RDF markup = OBSERVED margin only; never an input. No pricing rule anywhere.
- Depreciation: straight-line, annual, zero residual, by class (rates in settings).
  Capitalisation threshold default Tk 10,000 (a setting).

## TB Care (restricted)
- Reported to BRAC by the TB Care team. We do NOT reproduce its ledger. Carry only
  the restricted fund balance (disclosed, excluded from operating totals) + rent
  clearing (2410). Enforce exclusion at DB level, not a report-time filter.

## Banking & investments
- Clinics: SJIB only since Feb 2026. EXIM clinic accounts FROZEN (disclosed, excluded).
- HQ: AB Bank (operating + ~16 FDR/MIDS), UCB (~3 FDR). ~Tk 4.15 cr invested.
- Investment interest taxed 20% at source → auto gross/net split.
- **FDR/MIDS data as of 18 Feb 2026 is STALE — refresh before seeding HQ opening balances.**

## Tech / data
- Supabase NUMERIC returns strings in JS — parse with a Zod transform.
- RLS does not cascade to Storage buckets — set bucket policies separately.

## Currency
- Currency is BDT (Bangladeshi Taka), subdivided into paisa (1 Taka = 100 paisa).
  NEVER "rupees" (wrong country). Use Taka/BDT/paisa in all code, comments, errors.
- Money stored as NUMERIC(15,2) in Postgres. In the engine, all balance and threshold
  comparisons use INTEGER PAISA (Math.round(value * 100)) — never raw JS floats.
  The value written to the DB derives from the same paisa rounding that is checked.

## Users
- Clinic managers non-technical — entry must work without instructions.
- Managers see/enter ONLY their own entity's data. Consolidated = HQ/Admin/Auditor only.
