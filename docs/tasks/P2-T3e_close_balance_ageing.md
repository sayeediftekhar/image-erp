# P2-T3e — C-Section Discharge: Close-Balance Action + Ageing View + Entity Authz (task spec)

**Phase 2 · closes the C-section lifecycle.** T3d opened the lifecycle (admission → advance held in
2150). T3e closes it: the manager records the itemized discharge bill, the existing
`closeDeliveryBalance` posts it (income recognised, 2150 released, balance/refund cash), and the
delivery_balance row flips CLOSED. Plus the ageing/follow-up view (`getFlaggedOpenBalances`) and the
entity-scoped authorization the close endpoint currently lacks (GitHub issue #6 — closes with this
task). Last task in the revenue/delivery arc before the expense form.

**Authorities:** `Phase2_Revenue_Mapping_v2.md` §3 (the discharge model — canonical);
`wizard_design.md` (close-balance action, P2-T3e line); `packages/posting-engine/src/revenue.service.ts`
(`closeDeliveryBalance` and `getFlaggedOpenBalances` — BOTH ALREADY COMPLETE and tested; this task
calls them, does not rebuild them); the T3a/T3b/T3d auth + entity-isolation route pattern. On
conflict, flag.

---

## 0. Critical context — the engine half is already built

- `closeDeliveryBalance(deliveryBalanceId, finalBill, dischargeDate, actorId)` already: locks the
  delivery_balance row (must be OPEN — idempotency guard), posts the discharge entry
  (Dr 2150 release advance + Dr 1010 balance received, OR Cr 1010 refund if overpaid / Cr 4030 PI
  service+seat / Cr 4110 RDF medicine / Cr 4130 RDF logistics), and flips the row CLOSED with the
  final bill columns + close_entry_id. Balanced by construction (proven T2b). `finalBill` =
  `{service_charge, seat_rent, rdf_amount, logistics_amount}` (CloseFinalBill).
- `getFlaggedOpenBalances(entityId?)` already returns OPEN balances older than
  `delivery_balance_flag_days` (default 4), using `revenue_date` (admission) for ageing, with
  `days_open` computed. Already used by the dashboard.
- **T3e does NOT modify the engine.** It builds: the discharge UI, the ageing/list view, and the
  close route — and adds entity authz at the route layer.

## 1. The problem (one sentence)

A manager needs to see their open C-section balances (with overdue ones flagged), open one, enter
the itemized final bill, and record the discharge — turning the held advance into recognised income
and closing the follow-up, via the existing engine, scoped so a manager only touches their own
clinic's balances.

## 2. Output contract — a list view, a discharge form, one route (+ authz)

- **Deliveries list view** (the surface the existing /deliveries nav points at, JAL/NAS only) →
  shows OPEN balances (patient, advance, admission date, days-open, flagged if overdue) and,
  secondarily, recently CLOSED ones. Query-backed: OPEN/flagged via `getFlaggedOpenBalances` plus a
  query for all OPEN (not just flagged) for the entity.
- **Discharge form** (opened from a list row) → captures the itemized final bill
  (service_charge, seat_rent, rdf_amount, logistics_amount) + discharge date → calls the close route.
- **Close route** (`POST /api/manager/close-balance` or similar) → auth + **entity-scoped authz**
  (issue #6) → calls `closeDeliveryBalance`. Returns CloseResult.
- The list shows the result of closing (the row moves OPEN→CLOSED; income now recognised).

## 3. The discharge form (from §3 + CloseFinalBill)

Opened for a specific OPEN delivery_balance. Shows (read-only context) the patient name, receipt no,
phone, advance already paid, admission date — so the manager knows who/what they're billing. Then
captures the itemized bill:
| UI field | finalBill key | → account (engine posts) | Fund |
|---|---|---|---|
| Service charge (Tk) | `service_charge` | 4030 PI-C-Section | PI |
| Seat rent (Tk) | `seat_rent` | 4030 (folds into same account) | PI |
| Medicines / consumables (Tk) | `rdf_amount` | 4110 RDF-Medicine | RDF |
| Logistics (Tk) | `logistics_amount` | 4130 RDF-Logistic | RDF |
| Discharge date | (dischargeDate arg) | — | — |

- **Show the manager the cash consequence before they confirm** (this is the adoption-trust piece,
  mirroring T3d's reconciliation transparency): total bill = sum of the four; advance already held =
  (from the row); **balance to collect = total − advance** (or **refund to return** if negative).
  Display it plainly: "Total bill Tk X · Advance held Tk Y · Collect Tk Z from patient" (or "Refund
  Tk Z to patient" when overpaid). The engine computes `balancePaid = totalBill − advance`; the UI
  must show the same figure so the manager isn't surprised.
- Money inputs: reuse the T3d money-input fix — string state, `type="text"`, `strToMoney`
  (quantise to whole paisa at capture). Do NOT reintroduce `type="number"` (the blur-reformat
  mutation bug). Enter-to-advance nav consistent with the wizard.
- Total bill must be > 0 (the engine's CloseFinalBillSchema refine enforces it; the UI should guard
  too with a clear message).

## 4. The deliveries / ageing list view

- Per-entity (JAL/NAS). Lists OPEN balances: patient name, advance paid, admission date, days-open,
  and a **flag** (amber/red) when `days_open > delivery_balance_flag_days` (overdue — likely a
  missed discharge bill). The flag is the nudge: "record the discharge bill."
- Secondarily show recently CLOSED balances (collapsed/below) so the manager can confirm a discharge
  was recorded. Don't over-build — a simple OPEN-first, CLOSED-below list.
- Tapping an OPEN row → the discharge form. CLOSED rows → read-only (what was billed).
- All figures query-backed (Iron Law 1) — `getFlaggedOpenBalances` for the flagged set; a parallel
  query for all OPEN for the entity (flagged is a subset). Do NOT compute ageing in the client from
  created_at — the engine query already does it correctly off `revenue_date`.

## 5. Entity-scoped authorization (GitHub issue #6 — CLOSES WITH THIS TASK)

`closeDeliveryBalance` validates only `status = OPEN`; it does NOT check the actor's entity. The
**close route** must enforce it BEFORE calling the service:

- Authenticate (getUser + app_users role ∈ {ENTRY, ADMIN, HQ_FINANCE}, active).
- Fetch the delivery_balance row's `entity_id`.
- For ENTRY: `delivery_balance.entity_id` must equal the caller's `entity_id` → else 403 (a JAL
  manager cannot close a NAS balance; forged ids rejected). Same posture as save-draft/submit-day.
- The list view must also be entity-scoped server-side (a manager sees only their clinic's balances)
  — pass the caller's entity to the queries, never trust a client-supplied entity for ENTRY.
- Reference issue #6 in the PR; close it when this merges.

## 6. What stays out

- The engine (`closeDeliveryBalance`, `getFlaggedOpenBalances`) — frozen; do not modify.
- The fund-cash distortion (issue #7) and the discharge-cash-vs-daily-reconciliation seam (issue #8)
  — both deferred to Phase 4/5; do NOT attempt to fix here. (All discharge cash routing to 1010/PI
  is the known, accepted simplification.)
- Patient-record features (dedup, merge, IDs) — future patient module; this is a financial
  follow-up tool only.
- The submitted-day correction flow (issue #5) — unrelated, separate task.

## 7. Tests / verification

- Discharge form produces a valid CloseFinalBill; total-bill-must-be-positive guarded.
- balancePaid display: a bill > advance shows "Collect Tk Z"; a bill < advance shows "Refund Tk Z";
  matches what the engine computes.
- Close route: ENTRY closing own-entity balance → success; ENTRY closing another entity's balance →
  403 (issue #6); closing an already-CLOSED balance → 409 (engine idempotency guard surfaced);
  unknown id → 404.
- List view: shows OPEN balances for the caller's entity only; flagged set matches
  getFlaggedOpenBalances (> flag_days); CLOSED shown separately.
- Browser (Sayeed gate — throwaway data, live Supabase): admit a C-section in the wizard (advance
  held), then discharge it here → enter the itemized bill → confirm the cash-consequence display
  (collect/refund) → close → row flips CLOSED, and via SQL the discharge entry posted (Dr 2150 +
  Dr/Cr 1010 / Cr 4030/4110/4130), 2150 for that patient released. Verify an overpayment (bill <
  advance) posts a refund (Cr 1010). Verify a JAL manager cannot see/close a NAS balance. Verify the
  ageing flag appears on a balance older than flag_days.
- The month-end reconciliation that proves correctness (per §3): after closing, the 2150 balance =
  Σ remaining OPEN advances. Spot-check via SQL.

## 8. Definition of done

A manager sees their clinic's open C-section balances (overdue ones flagged), opens one, enters the
itemized discharge bill, sees the collect/refund consequence, and closes it — the existing engine
recognises the income (4030/4110/4130), releases the 2150 advance, records the balance/refund cash,
and flips the row CLOSED. The close route is entity-scoped (issue #6 closed). Money inputs use the
T3d string/paisa fix. Then: CONTEXT.md session block + LEARNINGS if any durable quirk; reference and
close issue #6. Do NOT commit until Sayeed browser-verifies on throwaway data (live Supabase;
posted entries immutable).

---

### Plan-first

Return a plan: the deliveries list view (OPEN + flagged via getFlaggedOpenBalances, CLOSED below,
entity-scoped queries); the discharge form (itemized bill + the collect/refund display, money-input
reuse); the close route (auth + entity authz per issue #6); how the list refreshes after a close
(the T3d post-submit-refresh lesson); and the test list (incl. the 403 cross-entity test and the
overpayment/refund case). Wait for approval. Do not commit.
