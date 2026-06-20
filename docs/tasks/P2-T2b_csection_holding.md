# Task Spec — P2-T2b: C-section holding-account model + discharge close-balance service

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Backend only — NO UI. Corrects the C-section path committed in P2-T2 (which treated C-section
> as same-day income and posted a redundant safe_delivery income line) to the holding-account
> model, and adds the discharge close-balance service. Reuses the posting engine + the
> externalClient pattern from P2-T2. Tested via SQL + Jest, no screens.

## Why this task (the correction)
Reviewing a real C-section bill revealed the model P2-T2 built is wrong for C-section:
- **"Safe Delivery" is NOT a third income type** — it is the PARENT grouping of C-section + NVD.
  The standalone safe_delivery income line in P2-T2 was a spreadsheet-era manual cross-check sum;
  in the ERP it DOUBLE-COUNTS. Remove it.
- **C-section income is NOT same-day.** A C-section patient is admitted, pays an ADVANCE, stays
  ~3 days, and the FINAL ITEMIZED BILL at discharge is the income event (service charge + seat
  rent + RDF medicines + logistics — split across funds, from the manager's bill breakdown). The
  advance is cash held against the patient until the bill settles. P2-T2 has no holding account
  and recognised C-section income at admission with an unknowable fund split — wrong.
- **NVD is correct as-is** — same-day income (paid in full the day of delivery), posts 4020/4110/
  4130. Unchanged.

## The locked C-section model
**Stage 1 — admission day (daily revenue entry):** advance cash in →
`Dr Cash (1010 PI) / Cr 2150 Patient Advances` (a LIABILITY, money held, NOT income). Plus a
delivery_balance OPEN row (receipt#, name, phone, advance, expected_date). No income recognised.

**Stage 2 — discharge day (final bill, a SEPARATE action):** the manager enters the itemized
bill breakdown; the income is recognised on the discharge day, split by fund, with the advance
released from 2150 and the balance paid as new cash:
- `Dr 2150` = advance amount (release the held liability)
- `Dr Cash (1010 PI)` = balance paid today (new cash)  — OR if overpaid, `Cr Cash` = refund
- `Cr 4030 PI-C-Section` = service_charge + seat_rent
- `Cr 4110 RDF-Medicine` = RDF medicines total
- `Cr 4130 RDF-Logistic` = logistics total
- Balance identity: advance + balance = total bill = 4030 + 4110 + 4130 (refund case: advance =
  bill + refund). Balanced by construction.
- delivery_balance → CLOSED (closed_date = discharge day).

**Deposit decoupling (confirmed):** income recognition (discharge day) is INDEPENDENT of when the
advance cash was deposited (often days earlier, in the normal deposit run). No same-day
revenue=deposit matching anywhere — the cash + 2150 accounts carry balances across days/months.

## Reference
- `docs/.../Phase2_Revenue_Mapping_v2.md` (§1, §3), the committed `revenue.service.ts` +
  `draft-data.schema.ts` (P2-T2), `ledger.service.ts` (engine + postTransactionOnClient),
  `0006_chart_of_accounts.sql` (account pattern), `0011`/`0012` (revenue_day, delivery_balance).

## Part 1 — Migration 0013
- **Add account `2150` — "Patient Advances / Deposits Received"**, type LIABILITY, normal_balance
  CREDIT, fund PI, is_control false, requires_approval false. (Follow the 0006 insert pattern;
  SYSTEM actor.) This is the holding account.
- **Add setting `delivery_balance_flag_days`** default `4` (the ageing-flag threshold — a C-section
  stay is ~3 days; >4 days open = flag to Sayeed). Adjustable like the other settings.
- Test: account 2150 exists with the right type/fund; setting present = 4.

## Part 2 — draft_data schema correction (apps/api/src/revenue/draft-data.schema.ts)
- **Remove `safe_delivery` entirely** from the delivery object (it was the redundant cross-check
  sum — double-counts).
- **C-section section at admission** captures ONLY: the advance(s) + case details. The
  service_charge / rdf_revenue / logistic_revenue income fields are REMOVED from the admission-day
  csection shape (that income is the discharge bill, entered via the close action, not the daily
  entry). So csection on a daily entry = `{ cases, balances:[{receipt_no, patient_name, phone,
  advance, expected_date}] }` — note `expected_balance` may be unknown at admission (the bill
  isn't computed yet); keep it OPTIONAL or drop it (the final bill determines it). Decide in plan.
- NVD unchanged (`cases, service_charge, rdf_revenue, logistic_revenue`).

## Part 3 — Submit service correction (apps/api/src/revenue/revenue.service.ts)
- **Remove safe_delivery from `buildIncomeInput`** (the 4110/4130 safe_delivery lines — gone).
- **Remove C-section from `buildIncomeInput`** (no 4030/4110/4130 from csection at admission).
- **Add C-section advance posting:** for each csection balance with advance > 0, the advance is
  posted `Dr Cash 1010 / Cr 2150`. Two clean options — decide in plan: (a) one combined advance
  entry summing the day's C-section advances, or (b) fold into the existing flow. Either way it's
  a posting (not just the memo). The delivery_balance OPEN row is still written (already in P2-T2).
- daily_activity for C-section: keep the `cases` count (STATIC/CSECTION/cases) — stats unaffected.
- NVD income path unchanged.

## Part 4 — Close-balance service (the discharge final-bill flow)
New: `revenue.service.closeDeliveryBalance(deliveryBalanceId, finalBill, dischargeDate, actorId)`
where `finalBill = { service_charge, seat_rent, rdf_amount, logistics_amount, balance_paid }`
(seat_rent folds into 4030).
- SELECT FOR UPDATE the delivery_balance; must be status OPEN (idempotency — a CLOSED one can't
  re-close). Reject otherwise.
- Compute: `bill_4030 = service_charge + seat_rent`, `bill_4110 = rdf_amount`,
  `bill_4130 = logistics_amount`; `total_bill = sum`. `advance = delivery_balance.advance_paid`.
  `balance = total_bill − advance` (positive = patient owes/pays; negative = refund).
- Post (one entry, via the engine on a shared client, source_module='DELIVERY_CLOSE',
  source_id=deliveryBalanceId, entry_date=dischargeDate):
  - `Dr 2150 = advance`
  - if balance ≥ 0: `Dr 1010 Cash = balance`; else `Cr 1010 Cash = −balance` (refund)
  - `Cr 4030 = bill_4030`, `Cr 4110 = bill_4110`, `Cr 4130 = bill_4130` (filter zero lines)
  - Balanced by construction: Dr(2150)+Dr(cash) = advance + balance = total_bill =
    Cr(4030+4110+4130). (Refund: advance = total_bill + refund.)
- Flip delivery_balance → CLOSED, closed_date = dischargeDate, store the final figures (consider
  adding columns for the final bill breakdown, or rely on the journal entry — decide in plan).
- One transaction, rollback on any failure, idempotent (OPEN-only).

## Part 5 — The >N-day ageing flag
- A query/view `delivery_balance` OPEN rows where `(today − created_at::date) > 
  delivery_balance_flag_days` (the setting). Surfaces to Sayeed (a report/dashboard query — no UI
  now, but the query must exist + be tested). This is the safeguard that a forgotten discharge
  bill (open balance) gets escalated.

## Iron Laws
- L1 — all figures arithmetic from inputs (the bill breakdown the manager enters); no inference.
- L2 — balanced by construction; engine is the sole line-writer (close service CALLS it).
- L3 — actor stamped, audited. L4 — every line entity + fund (2150 = PI; income lines per bill).
- The advance/income decoupling from deposits is preserved (no same-day matching).

## Tests (Jest + SQL, NO UI)
1. 0013: account 2150 + setting present.
2. Admission: a C-section advance posts Dr 1010 / Cr 2150 (held, NOT income); delivery_balance
   OPEN written; NO 4030/4110/4130 income at admission; safe_delivery produces no income line.
3. Discharge: closeDeliveryBalance posts the bill split (4030 incl seat rent, 4110, 4130), releases
   2150, takes the balance as cash, flips CLOSED. Balanced. Income lands on the discharge date.
4. Refund case: final bill < advance → refund posts Cr Cash, 2150 fully released, balanced.
5. Idempotency: closing a CLOSED balance is rejected; re-submitting handled.
6. Cross-day: advance on day A, discharge on day B (and across a month) — 2150 carries it; income
   on day B only; no same-day revenue=deposit assumption anywhere.
7. The >4-day flag query returns an old OPEN balance, excludes a recent one.
8. Full regression: existing engine + migration suites green (note: P2-T2's safe_delivery/csection
   income tests must be UPDATED to the corrected model — flag any that change).

## On completion
Status, do NOT commit; Architect review + Sayeed verify (submit an admission advance + a discharge
bill via SQL/Jest, read the postings against the bill). Commit message must note it SUPERSEDES the
P2-T2 C-section/safe_delivery income path. Then commit + push + supabase db push (0013).
Next: P2-T3 — the revenue UI (wizard + management page) producing draft_data; the close-balance +
ageing surface get their UI then too.
