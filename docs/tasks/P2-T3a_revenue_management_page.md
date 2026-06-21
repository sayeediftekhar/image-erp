# P2-T3a — Revenue Entry Management Page (task spec)

**Phase 2 · the manager's revenue landing surface.** First task of the P2-T3 wizard slice
(a–e). This task builds ONLY the management/list page + the mark-closed quick action. The day
wizard itself (shell, session screens, delivery, wrap-up, submit) is P2-T3b–d; close-balance +
ageing UI is P2-T3e. Do not build any wizard step here.

**Authorities:** `docs/phase2/wizard_design.md` §"Screen 1 — Revenue Entry Management";
`docs/tasks/Phase2_Revenue_Mapping_v2.md` (reference only — this task posts NO income, see §0
caveat); `IMAGE_ERP_Build_Guidelines.md` Iron Laws + house style. On conflict, flag before coding.

---

## 0. One caveat to hold in mind (does not block this task)

`Phase2_Revenue_Mapping_v2.md` §1/§3/§7 and `wizard_design.md` "Step — Deliveries" are STALE on
the C-section / Safe-Delivery model (they predate P2-T2b's 2150 holding model). **A doc-
reconciliation gate is logged before P2-T3c.** T3a touches none of it: this page reads
`revenue_day` status and triggers submit of an empty (zero) day. It never routes C-section income
or reads the delivery model. Build T3a as specced; ignore the stale delivery text.

---

## 1. The problem (one sentence)

A clinic manager, on their phone, opening the app to enter revenue, needs to see their month as a
list of days — which are done, which are half-finished, which are missing — and tap a day to act
on it, including marking a full holiday closed in one tap.

## 2. Output contract

A Next.js App Router page at `apps/web/src/app/(manager)/revenue/page.tsx` (or the existing
manager route group if one exists — read the tree first; do NOT create a second group) that:

- resolves the signed-in user → their `app_users` row → `entity_id` and `role`;
- shows ONE entity (the manager's own) and ONE month at a time, with a month switcher;
- lists every day of the selected month classified Entered / Draft / Missing / Closed;
- floats needs-attention (Missing, Draft) to the top; submitted + closed below;
- opens the day wizard for a tapped Missing/Draft day (route only — wizard is T3b);
- marks a chosen day Closed via a zero-day submit (see §6).

Reads only `revenue_day` for this entity+month. Writes only via the mark-closed action (§6),
which goes through the existing `submitRevenueDay` service — NOT a direct `journal_lines` write
(Law 2; this page is not a ledger writer).

## 3. Roles & access

- **ENTRY** manager: sees only their own `entity_id` (from `app_users`, never a URL param —
  an entity in the URL must be ignored/overridden by the session entity for ENTRY).
- **ADMIN / HQ_FINANCE**: may view any entity; this task may scope to the user's own context and
  defer the entity-picker to a later task IF that keeps T3a atomic — but the data query must be
  written so an entity filter is a parameter, not hard-coded to the session. Read the existing
  admin role-resolution pattern (`(admin)/layout.tsx`, `getUser()` + `app_users`) and reuse it;
  do not invent a second auth path.
- The page lives OUTSIDE the `(admin)` route group (managers are non-admin; the admin gate
  redirects them to /home today — this task gives them a real surface). Gate the manager route so
  a logged-in ENTRY user reaches it and an unauthenticated user is redirected to /login, mirroring
  the established middleware/layout pattern. No client-side-only gating (LEARNINGS: gate in the
  server layout, no protected-content flash).

## 4. Day classification (the core logic)

For the selected month, for each calendar date from the 1st through `min(today, month-end)`:

| State       | Definition                                              | Visual (house style)          | Tap action                                    |
| ----------- | ------------------------------------------------------- | ----------------------------- | --------------------------------------------- |
| **Missing** | no `revenue_day` row for (entity, date), date ≤ today   | red accent, "Start"           | → wizard for that date (T3b route)            |
| **Draft**   | `revenue_day.status = 'DRAFT'`                          | amber accent, "Continue"      | → wizard, resuming draft (T3b route)          |
| **Entered** | `revenue_day.status = 'SUBMITTED'`, `total_revenue > 0` | green, shows Tk total         | non-tappable this task (read-only view = T3d) |
| **Closed**  | `revenue_day.status = 'SUBMITTED'`, `total_revenue = 0` | grey/muted, "Closed"          | non-tappable                                  |
| **Future**  | date > today                                            | not shown (or shown disabled) | none                                          |

- "Closed" and "Entered" are both SUBMITTED rows; the discriminator is `total_revenue` (0 vs >0).
  A zero-revenue submitted day = a marked-closed holiday. (This is sufficient for T3a; if a future
  task needs to distinguish "explicitly closed" from "genuinely zero income", add a flag THEN —
  do not add a column now, that's speculative.)
- **Ordering:** needs-attention first — Missing (most urgent, by date) then Draft — then
  Entered + Closed in date order below. A single visual divider between the two zones is enough.
- **Top counts strip:** Entered / Draft / Missing tallies for the month. Missing count in red is
  the catch-up nudge. (Closed need not have its own counter; fold into "not missing".)

## 5. Month switcher & late-entry reality

- Default to the current month on load.
- Manager can step back to previous months (they enter days late — `wizard_design.md`: batch
  entry, often days late). Stepping forward past the current month shows no actionable days.
- Use the entity's local calendar (Asia/Dhaka). "Today" must be Dhaka-local, not UTC — a day
  boundary error here mislabels the current day as Missing or hides it. Resolve "today" server-side
  in Dhaka time; do not trust the browser clock for the Missing cutoff.

## 6. Mark-closed quick action (the only write in T3a)

- A per-day "Mark closed" affordance on a **Missing** day (not on Draft/Entered/Closed).
- Confirm intent (one tap + confirm — closing a day is a submit, and submits are not freely
  reversible; a manager mis-tapping a working day as closed is the risk to guard).
- On confirm: ensure a `revenue_day` exists for (entity, date) in DRAFT with an empty/closed
  `draft_data`, then call the existing **`submitRevenueDay`** path for it. Per the engine,
  an all-zero day flips to SUBMITTED with `total_revenue = 0` and `journal_entry_id = null`
  (no income entry, no daily_activity rows, no delivery_balance rows — confirmed P2-T2b behaviour:
  zero-amount lines filtered, all-zero day skips the income entry entirely).
- **How the call is made:** reuse whatever invocation path the app already uses to reach
  `submitRevenueDay` (NestJS `apps/api` endpoint, or the server action / route handler the wizard
  will use). If NO such HTTP path exists yet (submit has only been exercised via Jest so far),
  then T3a must add a minimal server route/handler that (a) authenticates, (b) enforces the caller
  is ENTRY for that entity (or ADMIN/HQ_FINANCE), (c) creates-or-finds the DRAFT day, (d) calls
  `submitRevenueDay` with the authenticated actor, (e) returns the result. Flag in your plan
  whether you are adding this route or reusing an existing one — this is the one architectural
  fork in the task and I want to see which you found before you build it.
- The empty `draft_data` must satisfy the current Zod `DraftDataSchema` (post-T2b: all channel
  sections optional/absent, `delivery: {}` default). Produce the minimal object the schema
  accepts for a closed day; do not hand-craft journal lines.
- Entity authorisation on this write: an ENTRY user may close days ONLY for their own entity.
  Enforce server-side (not just by hiding the button). (This is the same entity-authz discipline
  the P2-T2b carried-forward gap demands of the close endpoint; apply it here too.)

## 7. House style (reuse, do not reinvent)

Navy `#0F0A52` surfaces / `#13007D` accents, Inter, WCAG AAA contrast, 44px touch targets, 16px
min font, mobile-first. Reuse the T8 admin components/patterns (cards-on-mobile / table-on-wider,
the AdminShell drawer pattern if a manager shell is wanted — or a simpler header for now). Managers
are non-technical and on phones: the list must be legible and tappable without instructions.

## 8. Explicitly OUT of scope (do not build)

- Any wizard step (T3b–d). Tapping a day routes to the wizard path; a placeholder wizard route
  returning "coming next" is fine if the wizard doesn't exist yet.
- Read-only view of a submitted day (T3d).
- Close-delivery-balance action, ageing flag view (T3e).
- Entity picker for ADMIN/HQ (keep the query parameterised; full picker can come later).
- Expense form (separate task).

## 9. Tests / verification

- Classification unit-tested: given a set of `revenue_day` rows + a reference "today", every date
  lands in the right bucket (Missing past vs future, Draft, Entered, Closed by total_revenue).
- Dhaka-local "today" boundary: a day that is "today" in Dhaka but already tomorrow in UTC (or
  vice-versa) classifies correctly. This is the highest-risk logic — test it explicitly.
- Entity isolation: an ENTRY user for JAL cannot load NAS days (server-side; a forged entity
  param is ignored). Test it.
- Mark-closed: closing a Missing day produces a SUBMITTED `revenue_day`, total 0, null
  journal_entry_id, and the day then renders as Closed. A second close attempt on the now-SUBMITTED
  day is rejected (the direction guard SUBMITTED→DRAFT is blocked — P2-T1).
- Browser-verify on a real JAL month before commit (Sayeed gate).

## 10. Definition of done

Manager logs in → lands on their month → sees Missing/Draft/Entered/Closed correctly ordered with
counts → can switch months → can mark a holiday closed in one confirmed tap and watch it become
Closed → tapping a Missing/Draft day routes toward the wizard. Entity-isolated, Dhaka-correct,
server-gated. No income posted by this page except the zero-day close through `submitRevenueDay`.
Then: CONTEXT.md session block + LEARNINGS if any durable quirk. Do NOT commit until Sayeed
browser-verifies.

---

### Plan-first

Return a plan before building: the route/group you'll use (and the §6 fork — existing submit path
vs new route), the files you'll add/touch, the classification function signature, how you resolve
Dhaka-local today server-side, and your test list. Wait for approval. Do not bundle commit/push.
