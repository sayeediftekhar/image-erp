# Task Spec — P1-T8b: Parties page + Settings page

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: two admin pages — Parties (CRUD) and Settings (edit-values form). Both REUSE the T8a
> shell, the responsive patterns (table→cards below md, the modal pattern), the styling standard
> (AAA contrast, 44px targets, navy brand, Inter), and go Next.js → Supabase directly via RLS
> (admin-write enforced by the existing policies). NO NestJS. Service_role key stays out of
> apps/web. Same guard rails: do not touch the engine, the ledger, auth, or any T8a logic beyond
> wiring the two new pages into the existing shell nav (the stubs become real links).

## Part A — Parties page (`/parties`)

CRUD on `public.parties` — vendors, debtors, instruments, counterparties. Same shape as the
Accounts page (T8a): table on desktop, cards on mobile, add/edit modal, deactivate-not-delete.

**Data:** `public.parties` columns — id, name, kind, control_account, contact, active (+ audit).

- `kind` enum: VENDOR / DEBTOR / INSTRUMENT / COUNTERPARTY.
- `control_account` → FK to `accounts(code)`, restricted to control accounts.

**Table / cards columns:** name, kind (badge), control_account (the code + maybe name), contact,
status (active/inactive). Search by name; filter by kind; filter by active/inactive.

**Add / edit modal (Zod-validated):**

- `name` (required), `contact` (optional text).
- `kind` — a select of the four kinds.
- `control_account` — a **dropdown populated from `accounts` where `is_control = true`** (fetch
  the control accounts; show code + name; store the code). The Blueprint mapping for guidance:
  VENDOR→2010 (AP), DEBTOR→1310 (Receivable), INSTRUMENT→1520 (Investments),
  COUNTERPARTY→1410/2210 (Inter-clinic). Don't hard-enforce the mapping (a party could
  legitimately point elsewhere), but the dropdown lists the control accounts to choose from.
- `active` toggle.
- Reuse the same modal styling, error-code mapping (permission denied, FK violation, etc.),
  44px/16px/focus-ring inputs from T8a.

**Deactivate-not-delete:** same as Accounts — set `active=false`; reactivate; no hard delete
(FK RESTRICT blocks deletion of a referenced party anyway).

**Note:** with zero parties seeded, the page starts empty — that's correct. Adding the first
party (e.g. a vendor like "Renata Ltd" → control 2010) is the test.

## Part B — Settings page (`/settings`)

NOT a CRUD list — an **edit-the-values form**. Two sub-sections.

**Section 1 — Scalar settings** (`public.settings`, key/jsonb):

- `capitalisation_threshold` (currently 10000) — "Minimum cost (BDT) to capitalise vs expense."
- `fiscal_year_start_month` (currently 7) — "Month the fiscal year begins (1–12)." PROVISIONAL.
- `high_value_approval_threshold` (currently 50000) — "Entry total (BDT) above which approval is
  required." PROVISIONAL (GitHub #2).
- Render each as a labeled field showing its current value + a description, with edit + save.
- Validate: thresholds are positive numbers; fiscal_year_start_month is an integer 1–12. Money
  values handled as exact (the jsonb stores the number; read/write precisely, no float games —
  the value is a whole BDT amount here).
- Save writes `settings.value` (jsonb) via Supabase (admin-write RLS). Show success/error.

**Section 2 — Asset-class depreciation rates** (`public.asset_classes`):

- Show the 6 classes (FURNITURE/MEDICAL/IT/VEHICLE/BUILDING/RENOVATION) with name, useful-life,
  and **annual_rate** (stored as a fraction, e.g. 0.1000 = 10%).
- **Edit the rate (and useful_life) only** — NOT add/remove classes (the set is fixed; a new
  class is a deliberate code task, like roles). Display rate as a percentage for readability
  (10.00%) but store the fraction (0.1000). Validate: rate > 0 and ≤ 1 (i.e. 0–100%);
  useful_life a positive integer.
- Save per-row (or a save-all) via Supabase. Same admin-write RLS.

**Settings UI shape:** clean labeled form/sections, NOT a CRUD modal. Edit-in-place or a small
"edit" affordance per setting, with save. Mobile: sections stack, fields full-width, 44px.

## Part C — Wire into the shell nav

- The SideNav stubs for **Parties** (under Finance) and **Settings** (under Administration)
  become real, active links to `/parties` and `/settings`. The other stubs (Fixed Assets, Users)
  stay stubs until T8c.

## Iron Laws / decisions in play

- L1 — money/rate values are exact; the depreciation rate stays a fraction in the DB; reads are
  precise (no float drift in display↔store conversion).
- L5 — both pages rely on RLS for admin-write (the settings/asset_classes/parties write policies
  from T1/T3); a non-admin write fails at the DB.
- Deactivate-don't-delete for parties; fixed set for asset classes (edit values only).
- Service_role key never in apps/web.

## Applicable LEARNINGS

- Supabase jsonb/NUMERIC handling — read settings.value precisely; display rate as % but store
  the fraction; don't introduce float error in the %↔fraction conversion (e.g. 25% ↔ 0.25).
- Reuse the T8a Pill, modal, error-mapping, responsive patterns — don't reinvent.
- Routing/rename discipline — the new pages live under (admin)/ reusing AdminShell.

## Acceptance (Sayeed verifies — desktop + a mobile/DevTools check)

**Parties:**

1. /parties loads (empty list initially); nav link works.
2. Add a vendor (name, kind=VENDOR, control_account=2010 from the dropdown, contact) → appears.
3. Edit it; deactivate/reactivate it; search + filter by kind work. Mobile shows cards.
   **Settings:**
4. /settings shows the 3 scalar settings with current values + the 6 asset-class rates.
5. Edit a scalar (e.g. change a threshold) → saves; reload → persists.
6. Edit an asset-class rate (e.g. IT 25%→20%) → saves as the fraction (0.20); reload → persists;
   displayed as 20.00%.
7. Both pages: AAA contrast, 44px targets, responsive, navy brand — consistent with Accounts.
8. `grep -r "service_role" apps/web/` nothing; app compiles.

> Note: building Settings is the moment the two PROVISIONAL values (fiscal_year_start_month,
> high_value_approval_threshold) become live-editable. Sayeed can confirm/change them here when
> ready — no need to decide the values now; the page makes them adjustable.

## On completion

End with exactly one status — do NOT commit; wait for Architect review + Sayeed's browser test.
Next: T8c — Fixed Assets page + Users page (create users, assign role+clinic, deactivate) →
Phase 1 complete.
