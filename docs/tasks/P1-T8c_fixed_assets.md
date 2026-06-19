# Task Spec — P1-T8c: Fixed Assets page

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: the Fixed Assets admin page (CRUD) only. NOT Users (that's T8d — needs the create-auth-
> user design discussion). Reuses the T8a shell, responsive table→cards, modal pattern, styling
> standard; Next.js → Supabase via RLS. NO NestJS, service_role key stays out of apps/web. Touch
> no engine/ledger/auth logic beyond wiring the Fixed Assets nav stub to a real link.

## Problem (one sentence)

The admin needs to enter and manage fixed assets (the capitalised-item register Sayeed populates
from the clinic count) — name, entity, asset class, purchase date, cost — while accumulated
depreciation stays read-only (populated by the Phase 4 depreciation run, never hand-entered).

## Data — `public.fixed_assets`

Columns: id (uuid PK), entity_id (FK→entities, NOT NULL), name, asset_class (FK→asset_classes.code,
NOT NULL), purchase_date, cost numeric(15,2), accumulated_depreciation numeric(15,2) default 0,
active boolean, + audit columns.

## Page (`/assets`) — CRUD like Parties

- **Table (desktop) / cards (mobile)** — same responsive pattern as Accounts/Parties.
- Columns: name, entity (clinic code/name), asset_class, purchase_date, cost (formatted BDT),
  accumulated_depreciation (read-only display), written-down value (cost − accum_depr, computed
  for display), status (active/inactive).
- Search by name; filter by entity (clinic); filter by asset_class; filter by active/inactive.
- Mutations key off `id` (uuid PK — name is not unique, same lesson as parties).

### Add / edit modal (Zod-validated)

- `name` (required).
- `entity_id` — dropdown of entities (the 6 clinics+HQ; fetch from `entities`, show code+name,
  store id).
- `asset_class` — dropdown of the 6 asset classes (fetch from `asset_classes` where active; show
  name; store code).
- `purchase_date` — date input.
- `cost` — numeric, BDT, ≥ 0. Use the exact-money discipline (no float games) — it's a whole
  NUMERIC(15,2); validate ≥ 0.
- `active` — toggle.
- **`accumulated_depreciation` — NOT an editable field.** In ADD mode it's not shown (defaults 0).
  In EDIT mode, show it READ-ONLY with a note: "Set by the depreciation run (Phase 4) — not
  hand-entered." This enforces Iron Law 1 (the figure comes from the deterministic run, never
  typed). Written-down value (cost − accum_depr) shown read-only too.
- Reuse the modal styling, 44px/16px/focus inputs, DB-error-code mapping from T8a/T8b.

### Capitalisation-threshold hint (nice-to-have, not enforced)

- The capitalisation threshold (a setting, default Tk 10,000) is the line above which something is
  an asset vs an expense. OPTIONAL: if cost is below the current threshold, show a gentle inline
  hint ("Below the Tk 10,000 capitalisation threshold — is this an asset or an expense?"). Do NOT
  block saving — it's the admin's call. Skip if it complicates the build; it's a hint, not a rule.

### Deactivate-not-delete

- Same as the other pages: `active=false` to retire/dispose an asset; reactivate; no hard delete
  (FK RESTRICT and the deactivate-don't-delete policy).

## Wire into nav

- The "Fixed Assets" SideNav stub (under Finance) becomes a real active link to `/assets`.
  Users stays a stub (T8d).

## Iron Laws / decisions in play

- L1 — accumulated_depreciation is read-only here; it's computed by the Phase 4 run, never typed.
- L4 — every asset carries an entity (the owning clinic).
- L5 — RLS: entity-scoped read (a manager would see only their clinic's assets — though only
  admins reach this panel now); admin-write enforced by the existing fixed_assets policy.
- Deactivate-don't-delete; money exact (NUMERIC, no float).
- Service_role key never in apps/web.

## Applicable LEARNINGS

- Mutate by id, not name (uuid PK; name not unique) — same as parties.
- Reuse Pill, modal, error-mapping, responsive table→cards — don't reinvent.
- Money as exact NUMERIC; format for display, validate ≥ 0; no float drift.

## Acceptance (Sayeed verifies — desktop + DevTools mobile check)

1. /assets loads (empty initially — correct, no assets seeded); nav link works.
2. Add an asset (name, entity=a clinic, asset_class=MEDICAL, purchase_date, cost=50000) → appears;
   accumulated_depreciation shows 0; written-down value shows = cost.
3. In edit mode, accumulated_depreciation is READ-ONLY with the "set by depreciation run" note.
4. Edit name/cost → saves; deactivate/reactivate → status flips; search + filter (entity, class)
   work. Mobile shows cards.
5. AAA contrast, 44px, responsive, navy brand — consistent with the other pages.
6. `grep -r "service_role" apps/web/` nothing; app compiles.

## On completion

End with exactly one status — do NOT commit; wait for Architect review + Sayeed's browser test.
Next: T8d — Users page (create person + assign role/clinic + deactivate). T8d needs a design
discussion first: creating a Supabase Auth account requires the admin/service key which must NOT
be in the browser — so the create-user flow needs a server-side path (decided before T8d is specced).
After T8d, Phase 1 is complete.
