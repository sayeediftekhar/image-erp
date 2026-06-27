# P2-T3f-B — Month-Completeness Gate + Admin Override (task spec)

**Phase 2 · entry discipline.** Layer a completeness gate onto the calendar (T3f-A): a manager
cannot enter a month past its 10th day until the *prior* month is fully resolved (every day
SUBMITTED or CLOSED). Blocked entry shows a nudge pop-up explaining what's unresolved; viewing and
deliveries stay open; the admin can grant a per-entity, per-month override from the admin panel.
This is the manager-facing precursor to the Phase-4 period-lock — shape it consistently but do NOT
build the full period-lock.

**Authorities:** the T3f-A calendar (the `locked?` tile hook + the `missing` count signal are already
in place for this); `classifyDays` (the single status source — "complete" = no MISSING days); the
`settings` table + admin-panel CRUD pattern (P1-T8) + the create-user server-route pattern (P1-T8d)
for the override control; `getDhakaToday`; the audit-trigger pattern (every monetary/config write
audited). On conflict, flag.

---

## 1. The problem (one sentence)
A manager who leaves prior-month days unresolved (neither submitted nor closed) must be stopped from
entering the next month past a grace window — so months can't pile up with holes — while keeping an
admin escape valve and never blocking the manager from *seeing* data or recording time-sensitive
discharges.

## 2. The gate rule (exact logic — server-side, never trust the client)
For a manager (ENTRY role) attempting to ENTER (open the wizard for / save) a day in month **N**:

**Entry is ALLOWED if ANY of:**
1. `today (Dhaka-local) ≤ the 10th of month N` — the grace window (first 10 days of a month are
   always open, for the late-entry batch tail).
2. `month N < the entity's go_live_month` — months before go-live are never gated (nothing to
   complete; pre-go-live days legitimately don't exist).
3. `month N−1 has zero MISSING days` — the prior month is fully resolved (every day SUBMITTED or
   CLOSED). "Complete" reuses `classifyDays`'s MISSING count = 0 for month N−1.
4. `an active override exists for (this entity, month N)` — admin granted a pass.

**Otherwise entry is BLOCKED** → the manager sees the nudge pop-up (§4), not the wizard.

Notes:
- "month N−1" for completeness is the calendar month immediately before N. (Entering July past
  July 10 requires June complete; the floor in rule 2 prevents chaining back past go-live.)
- The check is **server-side** — in the wizard page's server component (and the save/submit route as
  a backstop). A manager must not bypass the gate via the browser. The calendar's `locked?` tiles are
  a UI affordance, NOT the enforcement — enforcement is server-side.
- ADMIN / HQ_FINANCE roles are NOT gated (they can enter any month) — the gate is for ENTRY managers.

## 3. Persistence
### `month_gate_override` table (new migration)
Dedicated table (NOT crammed into settings). Columns:
- `id` uuid pk default gen_random_uuid()
- `entity_id` uuid not null → entities(id)
- `gated_month` text not null — the month being unlocked, format `YYYY-MM` (the month N the manager
  is allowed to enter despite N−1 incomplete)
- `granted_by` uuid not null → app_users / auth (the admin)
- `granted_at` timestamptz not null default now()
- `note` text null (optional reason)
- audit columns + the standard audit trigger (consistent with other config tables)
- unique (entity_id, gated_month) — one active override per entity per month (re-granting updates)
- RLS: ADMIN read/write; ENTRY/HQ_FINANCE read own-entity (so the gate check can see it); same matrix
  posture as other tables.

### `go_live_month` per entity
The entity's first gated month. Options: a column on `entities` (`go_live_month text null`) OR a
typed setting per entity. **Recommendation: a nullable `go_live_month` column on `entities`** (it's an
intrinsic entity property, set once). NULL = not yet live = gate never enforces for that entity
(safe default — a clinic with no go-live set is never gated, so the gate can't trap anyone before
it's deliberately switched on). Set/edited from the admin panel entities/settings surface.

## 4. The nudge pop-up (blocked-entry UX)
When a manager taps a gated day (or the server blocks entry), show a clear modal — NOT a dead-end:
- States the block plainly: "Finish [prior month] before entering [this month]."
- Shows WHAT is unresolved: "[Prior month] has N unresolved days. Submit them or mark them closed."
- Points to the fix: a link/button back to the prior month's calendar (where the missing days are
  red and one-tap resolvable). The manager resolves them → the gate clears automatically (rule 3) →
  the month reopens with no further action.
- Does NOT offer the manager any self-override. The only escape is resolving the days or an admin
  grant. (Self-override would defeat the gate.)
- The tone is a nudge, not a punishment — it tells them exactly what to do.

## 5. Calendar integration (uses T3f-A's hooks)
- When viewing a gated month N (blocked per §2), the calendar still RENDERS (viewing is never
  blocked) but the enterable tiles (MISSING/DRAFT) show a `locked` treatment (the `locked?` prop
  T3f-A reserved) — greyed + a small lock indicator — and tapping them opens the nudge pop-up instead
  of the wizard.
- SUBMITTED/CLOSED tiles in a gated month remain tappable to their read-only views (viewing open).
- A banner on the gated month makes the state obvious before the manager taps: "[Prior month]
  incomplete — finish it to enter [this month]" with the unresolved count.
- The grace-window case (≤ 10th) and the override case render NORMALLY (no lock) — entry proceeds.

## 6. Admin override control (admin panel)
- In the admin panel, an admin can grant an override: pick entity + month → creates/updates a
  `month_gate_override` row (granted_by = admin, granted_at = now). Logged via audit.
- Show existing active overrides (entity, month, who, when) so the admin can see/revoke. Revoke =
  delete the row (or a revoked flag — deletion is fine here since the audit log retains the history).
- Also expose `go_live_month` per entity here (set it once at go-live). Reuse the existing
  settings/entities admin pattern + the server-route pattern (admin-verified server action; service
  role only if needed, per the P1-T8d learnings — admin's own session for RLS-permitted writes).
- This is ADMIN-only (the admin panel is already admin-gated in layout.tsx).

## 7. What stays out
- The full Phase-4 period-lock (open→pending-close→locked, maker-checker close). This gate is the
  manager-facing precursor; don't build the formal lock.
- Blocking VIEWING, deliveries, or discharge — only NEW revenue-day ENTRY past the grace window is
  gated. A gated manager can still record a C-section discharge (time-sensitive) and view everything.
- Self-service override for managers.
- Historical/bulk data import (deferred; pilot starts clean — opening balance is Phase 6).

## 8. Tests / verification
Server-side gate logic (pure function where possible — `isEntryAllowed({today, monthN, goLiveMonth,
priorMonthMissingCount, hasOverride})`):
- today ≤ 10th of N → allowed (grace), regardless of prior month.
- today > 10th, prior month missing=0 → allowed.
- today > 10th, prior month missing>0, no override → BLOCKED.
- today > 10th, prior month missing>0, override exists → allowed.
- month N < go_live_month → allowed (pre-go-live, never gated).
- go_live_month NULL → never gated (safe default).
- ADMIN/HQ_FINANCE role → never gated.
Override table: unique (entity, month); re-grant updates; RLS (ADMIN write, ENTRY read own); audited.
Server enforcement: the wizard page server component blocks a gated entry (redirect/nudge), and the
save/submit route rejects a gated write as a backstop (a manager can't bypass via direct POST) →
appropriate status + message. Entity-scoped (a JAL override doesn't unlock NAS).
Calendar: gated month shows locked tiles + banner; grace-window/override month renders normal;
viewing/submitted tiles still open.
Admin panel: grant override creates the row (audited); list shows active overrides; go_live_month
settable per entity.
Browser (Sayeed gate): set JAL go_live; with prior month incomplete and today > 10th, entering the
current month is blocked with the nudge → resolve the prior month's missing days → entry reopens
automatically; grant an override from admin → entry allowed despite incomplete prior month; confirm a
gated manager can still record a discharge and view submitted days; confirm ADMIN isn't gated.

## 9. Definition of done
An ENTRY manager past a month's 10th day cannot enter that month while the prior month has unresolved
days (server-enforced), sees a nudge pop-up that explains and points to the fix, and is unblocked
automatically on resolving the days OR by an admin override; the grace window, pre-go-live months, and
ADMIN role are exempt; viewing and discharge are never blocked; the admin grants/revokes per-entity
per-month overrides and sets go_live_month from the admin panel (audited). Migration for
`month_gate_override` + `entities.go_live_month`. Then: CONTEXT.md session block + LEARNINGS; deploy
migration before dependent code. Do NOT commit until Sayeed browser-verifies.

---

### Plan-first
Return a plan: the migration (`month_gate_override` table + `entities.go_live_month` + RLS + audit);
the pure `isEntryAllowed` gate function + where it's called server-side (wizard page + save/submit
backstop); the prior-month-missing-count query (reuse classifyDays); the nudge pop-up; the calendar
locked-tile + banner integration (via T3f-A's locked? hook); the admin-panel override-grant control +
go_live_month setter (reusing P1-T8 patterns); and the test list. Confirm migration deploys before
dependent code. Wait for approval. Do not commit.
