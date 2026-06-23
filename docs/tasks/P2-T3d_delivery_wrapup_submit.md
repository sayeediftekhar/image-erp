# P2-T3d — Delivery Step + Financial Wrap-up + Review + Submit Wiring (task spec)

**Phase 2 · the wizard finally posts.** The last revenue-wizard task. Builds the three remaining
steps (Delivery, Financial wrap-up, Review & Submit) and wires the EXISTING `submitRevenueDay`
service so the accumulated `draft_data` becomes real ledger entries. This is the FIRST task where
the wizard posts to the ledger — Law 2 engages here. Close-balance (C-section discharge) is T3e.

**Authorities:** `Phase2_Revenue_Mapping_v2.md` §2 (cash/deposit reconciliation identity), §3
(C-section 2150 advance), §1 (NVD same-day); `draft-data.schema.ts` (NvdSchema, CsectionSchema,
FinancialSchema — the shapes to produce); `wizard_design.md` Screen 2 (Delivery, Financial wrap-up,
Review & Submit + the read-only view); `packages/posting-engine/src/revenue.service.ts`
(`submitRevenueDay` — ALREADY COMPLETE; this task calls it, does not rebuild it). On conflict, flag.

---

## 0. Critical context — the service is already built
`submitRevenueDay(revenueDayId, actorId)` already: validates draft_data server-side, posts the
income entry (`buildIncomeInput`), the deposit entry (`buildDepositInput`), the petty-cash advance
(`buildAdvanceInput`), the C-section advance to 2150 (`buildCsectionAdvanceInput`), writes
`daily_activity` counts, opens `delivery_balance` OPEN rows, and flips the day to SUBMITTED with the
COMPUTED `total_revenue`. **T3d does NOT touch the engine.** T3d builds the UI that produces the
remaining `draft_data` (delivery + financial) and a server route that calls this service. The
dangerous posting logic exists and is tested (60+ Jest). T3d is UI + one thin route.

## 1. The problem (one sentence)
The manager has entered their sessions; now they record deliveries and the day's cash position,
see a transparent reconciliation against their physical cash count, review the day, and submit —
turning the whole draft into posted ledger entries via the existing engine.

## 2. Output contract — three steps + a submit route + read-only view
- **Delivery step** (clinics with delivery; per capabilities) → `draft_data.delivery.nvd` and
  `.csection`.
- **Financial wrap-up step** → `draft_data.financial` (bank_deposit, cash_advance,
  cash_in_hand_counted, reconciliation_notes).
- **Review & Submit step** → the confidence screen; calls the submit route.
- **Submit route** (`/api/manager/submit-day` or similar) → auth + entity isolation (reuse T3a/T3b
  pattern) → calls `submitRevenueDay`. Returns the SubmitResult.
- **Read-only view** of a submitted day → the same Review layout, no edit, for tapping a green day
  on the management list (deferred from T3a).

Each capture step saves its slice via the existing save-draft path (loose partial, DRAFT, entity-
isolated). Only the final **Submit** posts. Reuse T3b's save-draft route for the draft writes; add
ONE new route only for submit.

## 3. Delivery step (from §1 + §3 + the schema)

### NVD (clinics with `caps.delivery.nvd`; not CHA) — SAME-DAY INCOME
Schema `NvdSchema`. Fields → these post as same-day income (the engine's `buildIncomeInput` handles
NVD):
| UI field | draft key | → account (engine posts) | Fund |
|---|---|---|---|
| # cases | `cases` | — (stat → daily_activity STATIC/NVD) | — |
| Service charge | `service_charge` | 4020 PI-NVD | PI |
| RDF revenue | `rdf_revenue` | 4110 RDF-Medicine | RDF |
| Logistics revenue | `logistic_revenue` | 4130 RDF-Logistic | RDF |

### C-section (JAL/NAS only; `caps.delivery.csection`) — ADVANCE ONLY, NOT INCOME
Schema `CsectionSchema` = `{cases, balances[]}`. **NO income fields.** Per admission today, capture
into `balances[]` (DeliveryBalanceEntrySchema):
| UI field | draft key | Notes |
|---|---|---|
| # cases | `cases` | stat → daily_activity STATIC/CSECTION |
| (per balance) receipt no | `balances[].receipt_no` | optional |
| (per balance) patient name | `balances[].patient_name` | required (min 1) |
| (per balance) phone | `balances[].phone` | optional |
| (per balance) advance paid | `balances[].advance` | the cash received today |
| (per balance) expected balance | `balances[].expected_balance` | OPTIONAL (default 0) — unknowable at admission |
| (per balance) expected date | `balances[].expected_date` | OPTIONAL — YYYY-MM-DD |
- The advance posts (at submit) as Dr 1010/PI, Cr 2150/PI — a HELD LIABILITY, not income. The UI
  must frame this as "advance received / deposit held," NEVER as earnings.
- **NO service_charge / RDF / logistics income fields on C-section.** That income is the discharge
  bill (T3e). If you find yourself adding an income field to C-section, STOP — that is the old
  pre-T2b model the reconciled mapping removed.
- "Add another C-section patient" repeats the balance sub-form (multiple admissions/day).

## 4. Financial wrap-up step (schema `FinancialSchema`)
| UI field | draft key | Notes |
|---|---|---|
| Bank deposit made? | `bank_deposit.made` | boolean toggle |
| PI deposited (Tk) | `bank_deposit.pi_amount` | → engine posts Dr 1110/Cr 1010 |
| RDF deposited (Tk) | `bank_deposit.rdf_amount` | → engine posts Dr 1120/Cr 1020 |
| Cash advance amount | `cash_advance.amount` | rare; petty-cash/out-of-policy |
| Cash advance fund | `cash_advance.fund` | PI/RDF/null |
| Cash advance description | `cash_advance.description` | |
| **Cash in hand (physical count)** | `cash_in_hand_counted` | the manager's actual count — the reconciliation target |
| Reconciliation notes | `reconciliation_notes` | free text, nullable |

## 5. THE RECONCILIATION BLOCK (the adoption linchpin — get this exactly right)
This is the screen that earns manager trust. It shows computed-expected cash vs the physical count.

**The identity (P2-T2b-aware):**
```
opening_cash + income + advances_received − deposit − cash_advance = expected_closing
```
- `income` = the computed day income (PI cash + RDF cash from the session/NVD figures — the same
  sum the engine's `buildIncomeInput` produces). NOT the manager's typed total.
- `advances_received` = Σ C-section advances captured today. **This is cash IN that is NOT income**
  (it credits 2150, not a 4xxx). Omitting it mis-flags every C-section admission day as "off." This
  term is the single most important correctness point on this screen.
- `deposit` = `bank_deposit.pi_amount + rdf_amount` (if made).
- `cash_advance` = `cash_advance.amount`.
- Compare `expected_closing` to `cash_in_hand_counted`: **✓ matches** (green) or **⚠ off by Tk X**
  (amber). Transparent arithmetic shown, not just the verdict.

**OPEN QUESTION — opening_cash source.** There is no `opening_cash` field in `draft_data` today.
Options: (a) carry forward the prior day's `cash_in_hand_counted` for this entity (the real-world
behaviour — yesterday's closing IS today's opening); (b) a manual opening field; (c) assume 0 with
a note. Recommendation: (a) carry-forward — query the most recent prior SUBMITTED day's counted
cash for this entity; if none, 0. **Confirm with Sayeed before building — this is a real design
decision, not a guess.** Whatever is chosen, the reconciliation must be deterministic (Iron Law 1).

**KNOWN SEAM (do not try to solve here):** discharge-balance cash (from `closeDeliveryBalance` on a
different day) is OUTSIDE this identity — it's a logged P2-T3d/e gap. The daily reconciliation only
needs admission-day advances (captured here), not discharge cash. Don't fold discharge cash in.

## 6. Review & Submit step (the confidence screen + read-only view)
- **Headline:** Total revenue today — the COMPUTED figure (what the engine will store as
  `total_revenue`), never the manager's typed sum.
- **Section breakdown:** counts + money together (Morning N services Tk X, Evening, Satellite n
  teams, After-hours, NVD n cases). **C-section shows # cases + advance received (memo), NOT income.**
- **PI / RDF split** (the fund view, no Dr/Cr jargon).
- **Cash-reconciliation block** (§5): the ✓/⚠ verdict + transparent arithmetic.
- **channels_active enforcement (the T3c contract — comes due here):** `submitRevenueDay` does NOT
  filter by `channels_active` — `buildIncomeInput` posts whatever is in `sessions`/`delivery`. So a
  channel the manager DESELECTED in Step 1 whose slice still lingers in draft_data WOULD post. T3d
  must strip deselected channels' slices from draft_data BEFORE submit (clear `sessions.X` /
  `delivery.Y` / `satellite_teams` not in `channels_active`). State the approach in the plan; test it.
- **Edit** (jump back to any step) / **Confirm & submit** (green). Submit calls the submit route →
  `submitRevenueDay`. On success, the day is SUBMITTED; route back to the management list (day now
  green).
- **Read-only view:** the same layout, no edit/submit, for tapping a submitted day (deferred from T3a).

## 7. The submit route (the one new server route)
- `POST /api/manager/submit-day` (or similar). Auth → app_users role + entity. Entity isolation:
  ENTRY may submit only their own entity's day (verify the revenue_day's entity_id == the caller's;
  forged ids rejected) — server-side, same posture as save-draft/mark-closed.
- Calls `submitRevenueDay(revenueDayId, actorId)`. The engine already guards re-submit (non-DRAFT
  throws); map that to a clean 409. The UI should also not open submit on a SUBMITTED day.
- Returns SubmitResult. On the engine's "already SUBMITTED" → 409; validation errors → 400; else 500.
- **This route posts to the LEDGER. Dev currently points at LIVE Supabase** (carried-forward gap) —
  so a test submit writes real entries. Use a throwaway date/entity for browser verification, and
  be aware reversal is the only correction (posted entries are immutable).

## 8. What stays out
- The engine (`submitRevenueDay` and its builders) — frozen; do not modify.
- Close-balance / discharge bill (T3e).
- Expense form (separate task).
- Solving the discharge-cash reconciliation seam (logged; T3e integration).

## 9. Tests / verification
- Delivery step produces valid `delivery.nvd` (income fields) and `delivery.csection` ({cases,
  balances[]}, NO income fields). Regression: assert no C-section income field exists in the UI/slice.
- Financial step produces a valid `financial` slice (the schema's required fields present).
- Reconciliation arithmetic: a day with a C-section advance computes `expected_closing` INCLUDING
  the advance as cash-in; a unit test proves omitting it would mis-flag. Test the ✓ and ⚠ branches.
- channels_active enforcement: a draft with a lingering deselected `sessions.MORNING` does NOT post
  Morning income after submit (strip-before-submit verified end to end).
- Submit posts the RIGHT entries: income + (deposit/advance/csection-advance as applicable), day →
  SUBMITTED, total_revenue = computed sum, daily_activity + delivery_balance rows written. (Mirror
  the existing engine tests at the route level.)
- Submit entity isolation: ENTRY for JAL cannot submit a NAS day (forged id rejected).
- Re-submit a SUBMITTED day → 409, no double-posting.
- Browser (Sayeed gate): full JAL day end-to-end → delivery + wrap-up + reconciliation (✓ on a
  clean day; ⚠ when count is off) → submit → day green on list, entries in ledger (verify via SQL),
  total matches. A C-section admission day reconciles correctly (advance counted as cash-in). CHA
  day (no delivery step). Read-only view of the submitted day renders. Use throwaway dates (live DB).

## 10. Definition of done
A manager completes a day — sessions (T3c) + delivery + cash wrap-up — sees a transparent, correct
reconciliation (including the C-section advance term), reviews the computed totals (C-section as
memo not income), and submits → the existing engine posts income + deposit + advances + C-section
advance, writes stats + delivery_balance, flips SUBMITTED. Deselected channels don't post.
Entity-isolated. Then: CONTEXT.md session block + LEARNINGS. Do NOT commit until Sayeed
browser-verifies (on throwaway dates — this writes to live Supabase).

---

### Plan-first
Return a plan: the delivery-step UI (NVD + C-section advance, no income); the wrap-up UI; the
reconciliation computation (the identity incl. advances_received, and the opening_cash decision —
raise it, don't guess); the review screen + read-only view; the submit route (auth/entity
isolation); how channels_active is enforced before submit (strip approach); and the test list. Wait
for approval. Do not commit.

---

## STATUS: BUILT — pending Sayeed browser-verify (2026-06-23)

All code delivered. 99/99 web tests, 67/67 API tests green. Pending Sayeed browser-verify on
throwaway dates before commit. See CONTEXT.md Session 2026-06-23 for full build log.

**Known limitations logged (not solved here):**
1. Out-of-order batch entry: carry-forward openingCash uses most-recent SUBMITTED day; submitting
   days out-of-order gives a wrong carry-forward until the gap day is submitted. The reconciliation
   delta will flag the discrepancy.
2. First-day-ever opening_cash defaults to 0. Correct for new clinics; may need a "seed opening
   balance" admin entry at go-live for clinics with existing cash on hand.
