# P2-T3-shell — Manager App Shell + Navigation + Home Dashboard (task spec)

**Phase 2 · the manager's home base.** The manager-side parallel to the admin T8a shell,
inserted before the wizard (P2-T3b) so the wizard and every later manager surface lives inside a
consistent frame. Builds the persistent navigation, the header (identity + sign-out), and a real
Home dashboard that aggregates the manager's open loops. Option A: full adaptive nav now, real
content where the backend exists, honest phase-labelled stubs for the rest.

**Authorities:** `docs/tasks/wizard_design.md` (house style, per-clinic service matrix);
`IMAGE_ERP_Build_Guidelines.md` Iron Laws + §"adoption over sophistication"; CONTEXT.md
(manager report-access decisions, carried-forward gaps). On conflict, flag before coding.

---

## 0. What the manager does (the workflow the nav must mirror)
A clinic manager, on a phone, has a few distinct jobs with different rhythms:
- **Enter revenue** — daily-ish, often batched days late ("what haven't I done?").
- **Enter expenses** — periodic, voucher/cheque-driven (future task).
- **Chase delivery balances** — ongoing C-section admit→discharge follow-up (JAL/NAS only).
- **Review** — their clinic's I&E, operational stats, and bank reconciliation (Phase 4/5).
The nav mirrors these JOBS, not the database tables. The manager's true landing is "what needs my
attention," not a static menu — so Home is an attention aggregator, not a logo splash.

## 1. The six destinations (the manager's whole world)
| # | Destination | Status today | Built by |
|---|---|---|---|
| 1 | **Home / Dashboard** | REAL (this task) | P2-T3-shell |
| 2 | **Revenue** | REAL (exists) | P2-T3a (→ wizard T3b–d) |
| 3 | **Expenses** | STUB (phase-labelled) | future Phase 2 task |
| 4 | **Deliveries** | REAL-MINIMAL (backend exists) | list here; full UI P2-T3e |
| 5 | **Reports** | STUB (phase-labelled) | Phase 4 |
| 6 | **Bank Reconciliation** | STUB (phase-labelled) | Phase 5 |

**Grouping — doing vs viewing:**
- *Doing* (act on something): Home, Revenue, Expenses, Deliveries.
- *Viewing* (read a result): Reports, Bank Reconciliation.

**Manager report-access scope (from CONTEXT — enforce in the stub labels so expectations are
right):** managers see THEIR clinic's Income & Expenditure (cost-recovery), operational/statistical
reports, and THEIR bank reconciliation — released when the month is marked ready. They do NOT get
the balance sheet, cross-entity consolidation, or the board report (HQ/Admin only). The Reports and
Bank-Rec stubs should describe the manager-scoped version, not promise the full accounting stack.

## 2. Navigation layout (mobile-primary, adaptive)
Managers are on phones — design mobile-first, desktop is the widened case.

- **Mobile (primary): bottom tab-bar** with the four *doing* destinations — Home, Revenue,
  Expenses, Deliveries — plus a **"More"** entry that opens Reports + Bank Reconciliation (and
  sign-out/identity if not in a header). Five slots max on a bottom bar; the two *viewing*
  destinations live behind More until they're real surfaces.
- **Desktop (widened): sidebar** showing all six, grouped with a divider: *doing* (Home, Revenue,
  Expenses, Deliveries) above, *viewing* (Reports, Bank Reconciliation) below. Mirrors the admin
  SideNav's grouped pattern (FINANCE / ADMINISTRATION) so admin and manager feel like one app.
- The active destination is clearly indicated. 44px touch targets, 16px min font.

## 3. Per-clinic adaptation (the nav itself flexes)
The same service-matrix logic that drives the wizard steps drives which nav items appear:
- **JAL / NAS:** all six (they do C-section → Deliveries shown).
- **AMB / KAT:** Deliveries is NVD-only; for THIS task, show Deliveries (NVD balances are not
  tracked as advances, so the Deliveries surface may be near-empty — acceptable; or hide if the
  service matrix says no advance-tracked deliveries). Flag your reading in the plan.
- **CHA:** NO delivery channel at all → **Deliveries hidden entirely** from the nav.
A manager never sees a destination for something their clinic doesn't do. Resolve the clinic's
capabilities from a single service-matrix source (entity code → capabilities), not scattered
conditionals — so the wizard (T3b) can reuse it.

## 4. The Home dashboard (the piece that makes nav a workflow)
The landing surface. NOT a static welcome — an aggregator of the manager's open loops, each a
tap-through to the surface that resolves it. Build with REAL data where the backend exists:

- **Missing / draft revenue days** (this month): count + the oldest few, tap → Revenue list (or
  straight into the wizard for that date). Reuse P2-T3a's `classifyDays` / Dhaka-today logic — do
  NOT reimplement the date logic; import it. (If it needs light refactor to be importable, that's
  in scope.)
- **Overdue delivery balances** (JAL/NAS): count + the oldest few, tap → Deliveries. Source:
  `getFlaggedOpenBalances(entityId)` — the P2-T2b ageing query (uses `revenue_date`, flags
  > `delivery_balance_flag_days`). This already exists; call it, don't rebuild it. Entity-scoped.
- **Month-at-a-glance** (light): the same Entered/Draft/Missing counts strip T3a has, so Home
  answers "how's my month" at a glance.
- **Expenses-pending / Reports-ready**: placeholders for now (no backend) — show nothing or a
  muted "coming soon" tile; do not fabricate counts (Iron Law 1 — no invented numbers).

**Iron Law 1 guard:** every number on the dashboard is a deterministic count from a DB query
(missing days from `classifyDays` over `revenue_day`; overdue balances from `getFlaggedOpenBalances`).
No estimated, inferred, or placeholder numbers presented as real. A stub tile shows no count, not a
fake one.

## 5. The header (identity + sign-out)
A persistent header across all `(manager)` pages:
- **Identity block:** manager name + role + **clinic NAME** (e.g. "Jalalabad", not "JAL") —
  resolve the entity name from `entities.name`. Role/entity already resolved in the
  `(manager)/layout.tsx` from P2-T3a — reuse it; do not add a second resolution path.
- **Sign-out:** returns to /login cleanly (mirror the existing /home sign-out). On mobile, sign-out
  may live in the header or under "More" — your call, but it must be reachable in ≤2 taps from
  anywhere.
- Logo + house style (navy #0F0A52 / Inter), consistent with admin so it's one app.

## 6. The shell component (the reusable frame)
A `ManagerShell` (the `AdminShell` parallel) wrapping `(manager)` routes:
- Server Component `(manager)/layout.tsx` keeps the auth/role gate (already there from T3a — do not
  weaken it); a Client Component holds nav state (active tab, mobile drawer/More state), mirroring
  the AdminShell split (server layout for auth, client shell for interactivity — LEARNINGS:
  gate in the server layout, no protected-content flash).
- The wizard (T3b) and later surfaces render INSIDE this shell, not as standalone pages. Revenue
  (T3a) must be moved to render inside the shell too (it currently has its own bare layout).

## 7. Role behaviour at the manager surface
- **ENTRY:** the target user — full manager shell, own clinic, nav adapted to clinic.
- **ADMIN / HQ_FINANCE:** may reach `/revenue` etc. but their primary home is elsewhere
  (ADMIN → /accounts). For this task: if a non-ENTRY role lands on a manager route, the shell must
  not break (no crash on null clinic). A full ADMIN entity-picker is OUT of scope (deferred, per
  T3a). Keep the entity context parameterised, not hard-coded to the session, so the picker can
  come later.
- Login dispatch unchanged from T3a (ENTRY → /revenue, soon → /home dashboard): update ENTRY's
  landing to the new **Home dashboard** route, since that's now the manager's true landing.

## 8. Explicitly OUT of scope (do not build)
- The wizard itself (T3b–d) — Revenue tab routes to the existing T3a list + wizard placeholder.
- The expense form (future Phase 2 task) — Expenses tab is a stub.
- Reports content (Phase 4) and Bank Rec content (Phase 5) — stubs with manager-scoped labels.
- The full Deliveries close/ageing UI (T3e) — Home links to it; the Deliveries surface itself can
  be a minimal list of `getFlaggedOpenBalances` rows here, or a stub if that risks bloating the
  task. State which in your plan.
- ADMIN entity-picker (deferred).

## 9. Tests / verification
- Nav adaptation: CHA resolves to a nav WITHOUT Deliveries; JAL resolves WITH it. Unit-test the
  entity→capabilities→nav-items mapping.
- Dashboard numbers are real: missing-days count matches `classifyDays` over seeded `revenue_day`
  rows; overdue-balances count matches `getFlaggedOpenBalances` for the entity. No fabricated
  counts on stub tiles.
- Entity isolation holds on the dashboard: an ENTRY user's dashboard shows only their entity's
  missing days and balances (server-side; forged param ignored — same posture as T3a).
- Sign-out returns to /login; identity block shows clinic NAME not code.
- Browser-verify on a real JAL login (Sayeed gate): lands on Home, sees real missing-days +
  overdue-balance counts, nav shows six (JAL); switch-test a CHA user (or simulate) shows no
  Deliveries; mobile bottom-bar + More works; sign-out works.

## 10. Definition of done
Manager logs in → lands on **Home dashboard** showing real open-loop counts (missing days, overdue
balances) → primary nav (bottom-bar mobile / sidebar desktop) gives the six destinations, adapted
to their clinic → Revenue is live, Deliveries shows real flagged balances (or a clean stub),
Expenses/Reports/Bank-Rec are honest phase-labelled stubs → header shows identity + working
sign-out → everything entity-isolated and Dhaka-correct, reusing T3a's logic not reimplementing it.
Then: CONTEXT.md session block + LEARNINGS if any durable quirk. Do NOT commit until Sayeed
browser-verifies.

---

### Plan-first
Return a plan before building: the shell/route structure, the entity→capabilities service-matrix
source (and how T3b will reuse it), how you import/reuse T3a's `classifyDays` for the dashboard
(refactor needed?), the Deliveries-tab decision (minimal list vs stub), the mobile bottom-bar +
More structure, and your test list. Wait for approval. Do not bundle commit/push.
