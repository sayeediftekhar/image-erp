# IMAGE ERP — Phase 2: Revenue Entry UI Design (LOCKED · P2-T2b-reconciled)

**Purpose.** The locked design for the manager revenue-entry surface, so P2-T3 builds from a
written spec, not chat memory. Pairs with `Phase2_Revenue_Mapping_v2.md` (the data model — what
each field maps to) — this doc is the *screens*. Mobile-first; reuses the T8 house style (navy
#0F0A52 surfaces / #13007D accents, Inter, AAA contrast, 44px touch targets, 16px min font).

> **P2-T2b reconciliation note (2026-06-21).** The "Step — Deliveries" section below was rewritten
> to match the shipped C-section **holding-account model**. The earlier version captured C-section
> service-charge / RDF / logistics income *at daily entry* and had a standalone *Safe Delivery*
> income step — both removed. Under the live engine: a C-section **advance** is held as a liability
> (Dr 1010/PI, Cr **2150** Patient Advances) on the admission day; the **income** (4030/4110/4130)
> is recognised only at **discharge** via `closeDeliveryBalance`, not on the daily form. *Safe
> Delivery* is the parent grouping of NVD + C-section, never a separate income line. NVD is
> unchanged (same-day income). `Phase2_Revenue_Mapping_v2.md` §1/§3/§7 still carry the old wording
> and are pending the same reconciliation pass before P2-T3c.

## Principle
A manager records ONE day once, via a guided wizard, save-as-draft throughout. On submit, the
system posts the money (engine) + writes the counts (daily_activity) — the manager never sees
debits/credits. Built for non-technical managers on a phone, who BATCH-enter several days in one
sitting, often days late.

## Two screens

### Screen 1 — Revenue Entry Management (the home/list)
Where a manager lands. The month as a list of days, grouped by what needs action.
- **Top counts:** Entered / Draft / Missing (Missing in red = the catch-up nudge).
- **"Needs attention" first:** missing days (red, "Start") + draft days (amber, "Continue")
  float to the top, so a manager catching up sees the gaps immediately.
- **Submitted days below:** green, with the day's total (Tk), tap to view (read-only review screen).
- **Closed/holiday days:** a quick "mark closed" action records a zero day without walking the
  wizard (e.g. a full holiday). Channels-active handles partial holidays (see wizard step 1).
  A marked-closed day = a SUBMITTED day with total_revenue 0 (no income entry, no stats rows).
- Batch-friendly: tap a missing day → wizard for that date; finish; next day. Date picker up front
  so entering a PAST date is natural (managers enter late; entered_at server-clock flags lateness).
- "Today" for the Missing cutoff is Asia/Dhaka-local, resolved server-side (not UTC, not browser).

*(Screen 1 = task P2-T3a.)*

### Screen 2 — The Day Wizard (opens for a chosen date)
Guided steps; Save-draft + Next at every step; the day is a DRAFT (nothing posted) until the final
Submit. Per-clinic adaptive (service matrix); steps only appear for channels that ran.

**Step 1 — Day setup.** Date (prefilled), and **"which channels ran today"** (toggles: Outdoor
morning/evening, After-hours, Satellite (+ how many teams), Delivery). This drives which subsequent
steps appear — solves holidays (only delivery on → skip to delivery + wrap-up; JAL holiday →
outdoor + delivery both on). A fully-closed day → no channels → zero day.

**Step 2 — Morning (outdoor session).** ONE clean scrollable screen (Option A), sectioned:
- *Patients & services:* new patients, old patients, total services, **service charge (Tk)**
  (navy-highlighted = the core income figure → 4010 PI-Outdoor).
- *Medicine & lab (RDF tag):* RDF medicine sales (Tk → 4110); # lab tests + lab revenue (Tk → 4120).
- *USG:* show the COMMON type (PP) by default; "+ Add USG type" reveals Lower/Whole/Anomaly
  (each: # patients + revenue → all post 4050; type is a stats dimension) — show-core/add-occasional,
  justified by fill-rate data.
USG is PART of the session (patients get USG during the session), not a separate step.

**Step 3 — Evening (outdoor session).** Identical shape to Morning (its own USG).

**Step 4 — After-hours.** # customers + service charge (→ 4010); RDF medicine sales (→ 4110);
**logistic sales** (→ 4130). After-hours RDF/Logistic is split → 4110 + 4130.

**Step 5…N — Satellite teams.** ONE step PER team (dynamic, from step-1 count). Each team =
the same session shape (patients, services, service charge → 4040, RDF → 4110, lab → 4120,
USG → 4050), tagged to that team (TEAM_1, TEAM_2, …) for statistics.

**Step — Deliveries** (only clinics that do them — see per-clinic matrix below).

- **NVD** (all clinics except CHA) — paid in full same day, so it is **same-day income**:
  # cases (stat), service charge (→ 4020 PI-NVD), RDF (→ 4110), logistics (→ 4130). No advance,
  no holding account.

- **C-Section** (JAL/NAS only) — **advance-holding model, NOT same-day income.** The daily wizard
  captures, per case admitted today:
  - **# cases** (stat → daily_activity CSECTION/cases);
  - **advance/balance capture** feeding the delivery-balance tracker: receipt#, patient name,
    phone, advance paid (received today). Expected balance / expected date are OPTIONAL (the final
    bill is unknown and negotiable at admission — a 0/blank placeholder is valid).
  The advance posts on submit as **Dr 1010/PI, Cr 2150/PI** (cash held as a liability) — combined
  per day across all admissions. **No service-charge / RDF / logistics income fields appear at
  daily entry** — that income is recognised at discharge, not here.
  The itemised discharge bill (service + seat → 4030, medicines → 4110, logistics → 4130, with
  2150 released) is entered later via the **close-balance action** (Screen / task P2-T3e), not in
  this wizard.

- *Safe Delivery is NOT a step.* It is the parent grouping of NVD + C-section in the old
  spreadsheet, not a distinct income line — removed (booking it double-counted the RDF streams
  already under NVD/C-section).

**Step — Financial wrap-up.** Total revenue (auto-summed CHECK figure). Bank deposit (made?
PI amount → 1110, RDF amount → 1120). Cash advance for expenses (rare; amount, fund, description →
out-of-policy path if over float limit). Cash in hand at end of day (manager's PHYSICAL count).
Reconciliation notes. The system shows computed-expected cash vs the count.

> **Reconciliation identity (P2-T2b-aware).** A C-section advance is cash IN that is **not income**
> (it credits 2150, not a 4xxx account). So the daily identity is:
> `opening + income + advances_received − deposit − cash_expense/advance = closing (physical count)`.
> The advance term is captured in *this* day's wizard (admission day), so the day's reconciliation
> includes it. **Known seam:** the discharge *balance* cash (and any refund out) is collected on a
> *different* day via `closeDeliveryBalance` and is therefore OUTSIDE this wizard — the discharge
> day's physical count will exceed the wizard's computed closing by the balance received. Resolving
> this (fold close-balance cash into the discharge-day reconciliation, or pull DELIVERY_CLOSE cash
> for the date) is a P2-T3d/e integration item, logged in CONTEXT carried-forward gaps.

**Step — Review & Submit.** The confidence screen (and the read-only view-a-day layout):
- Headline: Total revenue today (big).
- Section breakdown with COUNTS + money together (Morning 79 services Tk X, Evening, Satellite
  (n teams), Delivery n cases). C-section shows # cases + advance received (memo), not income.
- PI / RDF split (the fund view, no jargon).
- **Cash-reconciliation block** (the adoption linchpin): opening cash + income + advances −
  deposit = cash in hand, with "✓ matches your count" (green) or "⚠ off by Tk X" (amber).
  Transparent arithmetic.
- Edit (jump back) / **Confirm & submit** (green). Submit calls submitRevenueDay → posts income +
  the C-section advance entry + writes stats + delivery_balance OPEN rows + flips the day SUBMITTED.

## Draft / submit lifecycle (reuses P2-T1/T2/T2b)
- DRAFT = staged form data in revenue_day.draft_data; nothing posted; resumable from the management
  page. SUBMIT = submitRevenueDay fires: the engine posts the income entry AND (if any C-section
  admissions) the advance entry (Dr 1010/PI, Cr 2150/PI); daily_activity gets the counts;
  delivery_balance gets OPEN rows for C-section admissions; the day → SUBMITTED. The form PRODUCES
  the draft_data contract defined in `apps/api/src/revenue/draft-data.schema.ts` (post-T2b:
  csection = {cases, balances}; no csection income fields; no safe_delivery key).

## Per-clinic adaptation (service matrix)
- **JAL / NAS:** all channels, incl. NVD + C-section + satellite.
- **AMB / KAT:** NVD but NO C-section; satellite as applicable.
- **CHA:** NO delivery channel at all (Morning + Evening/Satellite only).
The wizard shows only the steps/fields a clinic uses; design against JAL (the most complex =
pilot) and the rest are subsets.

## Task slicing (P2-T3a–e)
- **P2-T3a** — Revenue Entry Management page (Screen 1) + mark-closed zero-day. *(done — committed 38083bd)*
- **P2-T3-shell** — Manager app shell: persistent header (logo, role/clinic display, sign-out), back/return-to-list navigation, role-correct landing. The manager-side parallel to the admin T8a shell; built before the wizard so T3b–e live inside it.
- **P2-T3b** — Wizard shell + draft lifecycle + Step 1 day-setup (channels-active).
- **P2-T3c** — Session screens (Morning / Evening / After-hours / Satellite) producing the income +
  counts portion of draft_data. **Gate:** reconcile `Phase2_Revenue_Mapping_v2.md` §1/§3/§7 to the
  2150 model before building.
- **P2-T3d** — Delivery step (NVD same-day + C-section advance) + financial wrap-up + review/submit
  + wire submitRevenueDay; the read-only view-a-submitted-day layout.
- **P2-T3e** — Close-balance action (record discharge bill → closeDeliveryBalance) + ageing view
  (getFlaggedOpenBalances) + entity-scoped authz on the close endpoint.

## Out of scope here (later tasks)
Expense form (fund-first, controlled dropdowns, petty-cash voucher/cheque) = its own task.
Reports (manager I&E, bank rec) = Phase 4/5 (target: docs/reference/Chandgaon_Monthly_Report).
