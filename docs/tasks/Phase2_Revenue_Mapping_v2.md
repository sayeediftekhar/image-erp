# IMAGE ERP — Phase 2 Design: Revenue + Expense → Ledger + Statistics Mapping (v2 — LOCKED)

**Purpose.** The canonical data model for the manager entry forms. Every field a manager enters
maps to (a) the **ledger** (journal entries) and (b) the **statistics store** (counts). The
wizard form, the expense form, and all three report types are built backwards from this.
Built from and validated against the real Jalalabad Google Form export.

**Status:** v2 — LOCKED, with §1/§3/§7 C-section sections REVISED per P2-T2b (2150 advance-holding
model) on 2026-06-22. The revision supersedes the original cash-basis C-section wording. All other
sections unchanged.

**Principles honoured:** Iron Law 1 (figures are deterministic, never AI), Law 2 (Σdr=Σcr via the
posting engine, the sole writer), Law 4 (every line tagged entity + fund), Law 6 (RDF purchases →
stock, never operating expense). Ledger = single source of truth; statistics = parallel
operational store sharing entity + date.

---

## 0. Core principle — one entry, two destinations

A manager records once. On submit, the system writes to two places:
- **MONEY → posting engine → journal entries** → FINANCIAL reports.
- **COUNTS → statistics store** → STATISTICAL reports + FUSED pivots.

The ledger never holds counts. Statistics never hold the authoritative money.

## 0b. The organizing fork — FUND FIRST (PI / RDF / Transfer)

Both forms are organised by fund, because fund determines routing:
- **PI** = service income (4010–4090) and operating expenses (5010–5090). Hits the P&L.
- **RDF** = three streams — **Medicine / Lab / Logistic**. Income → 4110/4120/4130. Purchases →
  STOCK 1210/1220/1230 (asset), becoming COGS 5210/5220/5230 monthly from the count. RDF
  purchases NEVER hit operating expense (Law 6 — enforced structurally by the fund choice).
- **Transfer** = inter-clinic/HQ movements → 1410/2210. Never income or expense; nets to zero.

| | **PI** | **RDF** (Medicine / Lab / Logistic) |
|---|---|---|
| Income | service charges → 4010–4090 | sales → 4110 / 4120 / 4130 |
| Expense/Purchase | operating → 5010–5090 | stock → 1210/1220/1230 → COGS 5210/5220/5230 monthly |

**Note: LAB = RDF** (income 4120, stock 1220, COGS 5220) — confirmed. A single outdoor session
generates BOTH PI income (service charge → 4010) AND RDF income (medicine → 4110, lab → 4120)
simultaneously; the form captures them together, the engine splits them across funds per line.

---

## 1. REVENUE — income line mapping (count + money per service group)

The 86 form columns collapse into service groups. Many fields feed the SAME income account — the
form separates them for STATISTICS, not the ledger.

### Outdoor / Static (Morning, Evening, After-hours)
| Manager enters | → Statistics | → Ledger | Fund |
|---|---|---|---|
| Morning new/old patients, total services | patients_new/old, services — channel=MORNING | — | — |
| Morning service charge | — | Cr **4010 PI-Outdoor** | PI |
| Morning RDF (medicine) sales | — | Cr **4110 RDF-Medicine** | RDF |
| Morning #lab tests + lab revenue | lab_tests — MORNING | Cr **4120 RDF-Lab** | RDF |
| Evening (same shape) | …channel=EVENING | 4010 / 4110 / 4120 | PI/RDF |
| After-hours #customers + service charge | patients — AFTERHOURS | Cr **4010 PI-Outdoor** | PI |
| After-hours RDF (medicine) sales | — | Cr **4110 RDF-Medicine** | RDF |
| After-hours Logistic sales | — | Cr **4130 RDF-Logistic** | RDF |
*After-hours RDF/Logistic is SPLIT into 4110 + 4130 (form asks the two amounts separately).*

### USG by type (outdoor)
| USG Lower / Whole / PP / Anomaly — #patients + revenue (each) | usg_count type=LOWER/WHOLE/PP/ANOMALY | Cr **4050 PI-USG** | PI |
*All USG types post to 4050; the type is a statistics dimension.*

### Satellite teams (dynamic count — Team 1 … Team N; each its own breakdown)
| Team N service charge | — (counts tagged team=N) | Cr **4040 PI-Satellite** | PI |
| Team N RDF / lab / USG | lab_tests, usg_count, patients — team=N | 4110 / 4120 / 4050 | RDF/PI |
*Satellite service charge has its own account (4040) so satellite is separable; RDF/Lab/USG share
the common accounts, team tag separates them in stats.*

### NVD (all clinics except CHA) — paid in full same day → cash income, no receivable
| NVD #cases | nvd_cases | — | — |
| NVD service charge | — | Cr **4020 PI-NVD** | PI |
| NVD RDF / logistics | — | 4110 / 4130 | RDF |

### C-Section (JAL/NAS only) — ADVANCE-HOLDING MODEL (see §3 for the lifecycle)
At daily entry, C-section captures ONLY the case count and the advance(s) received today.
NO income (4030/4110/4130) is posted at admission — the income is the itemized discharge bill,
recognised later via `closeDeliveryBalance` (see §3).
| Manager enters | → Statistics | → Ledger | Fund |
|---|---|---|---|
| C-Section #cases | csection_cases — STATIC/CSECTION | — | — |
| C-Section advance received today | — | Dr **1010 Cash** / Cr **2150 Patient Advances** | PI |
*The advance is HELD as a liability (2150), not booked as income. Per-day all C-section advances
combine into one entry (Dr 1010/PI, Cr 2150/PI). Income is recognised at discharge — see §3.*

### Safe Delivery — REMOVED (not an income line)
"Safe Delivery" was the spreadsheet's parent grouping of NVD + C-section, manually totalled as a
cross-check. It is NOT a distinct income stream. Booking it would double-count the RDF/logistics
already captured under NVD (same-day) and under the C-section discharge bill. It is removed from
the model entirely — there is no `safe_delivery` field, account, or posting.

### Other Income
| Other income — description + amount | (description as note) | Cr **4090 PI-Other** | PI |

---

## 2. CASH & DEPOSIT FLOW — the timing solution (proven by real data)

**Real data proof:** Feb 2 income Tk 60,035 but deposit Tk 124,000 (carries prior cash); Feb 4
holy day, zero income, cash-in-hand 139,312 (accumulated). Deposits NEVER match one day's income.
**Cash-in-Hand (1010, PI — one notional drawer) is the buffer.** Managers keep cash notionally as
PI; RDF income mostly untouched.

**Two/three separate events — never force them to match:**
- **A. Revenue earned:** `Dr Cash 1010 / Cr [income accounts §1]` — all day's income lands as cash.
- **B. Bank deposit (separate movement):** `Dr Bank (1110 PI / 1120 RDF) / Cr Cash` — moves
  accumulated cash to bank; amount = what was physically deposited (may span several days).
- **C. Cash advance / expense from cash:** see §4 (petty cash) + the out-of-policy path.

**Reconciliation identity (daily scrutiny):**
`Cash opening + cash income − deposit − cash expense/advance = Cash closing (manager's count)`
System computes expected closing; manager enters physical count; **mismatch → flag.** "Total
Revenue Today" = a check figure (system sums lines, confirms the manager's stated total).

**Month-rollover (salaries/doctor fees) = ACCRUAL:** `Dr Expense / Cr Payable` when earned (31st);
`Dr Payable / Cr Bank` when the cheque clears (5th). The payable holds it between = unpresented-
cheque view. (Accrual postings, not the daily revenue form.)

---

## 3. DELIVERY-BALANCE: C-SECTION ADVANCE-HOLDING MODEL (2150) + ageing follow-up

**Locked (Q1, revised per P2-T2b): ADVANCE-HOLDING, income recognised at DISCHARGE.** The final
bill is unknown and negotiable at admission (common in BD), so we do NOT recognise income at
admission and do NOT post a fixed receivable (1320) — both would be fictions. Instead:

- **Admission day (daily wizard):** the advance received is cash HELD as a liability —
  `Dr 1010 Cash (PI) / Cr 2150 Patient Advances`. NOT income. A `delivery_balance` row is opened
  (status OPEN) with the patient/advance details.
- **Discharge day (`closeDeliveryBalance`, NOT the daily wizard):** the itemized bill is the
  income, recognised in full on the discharge day — `Dr 2150` (release the held advance) +
  `Dr 1010` (balance received) / `Cr 4030` (service + seat rent, PI) + `Cr 4110` (medicines, RDF)
  + `Cr 4130` (logistics, RDF). Overpayment → `Cr 1010` refund. The row flips CLOSED. Balanced by
  construction (proven in P2-T2b).

**The `delivery_balance` tracker — a follow-up tool with ageing, not a receivable:**
- Captures (structured, not free text): receipt/registration number(s), patient name, phone,
  advance paid; expected balance / expected date are OPTIONAL (unknowable at admission).
- It does NOT post a 1320 receivable. It is an OPEN/CLOSED follow-up list with AGEING
  (`getFlaggedOpenBalances`, flagged at > `delivery_balance_flag_days`, default 4 — a C-section
  stay is ~3 days) that NUDGES the manager: an overdue OPEN balance = "record the discharge bill —
  make sure that income got captured." Daily-scrutiny applied to delivery income.
- **Reconciliation that proves it's right:** at month-end the 2150 balance must equal the sum of
  all OPEN delivery-balance advances. If 2150 > open advances, a discharge bill was likely missed
  (an advance never got closed) — which the >N-day ageing flag catches.
- **Scope: inpatient C-section. A financial follow-up tool — NOT a patient record system.** Real
  patient identity (IDs, dedup, merge, counselor) = future patient module, linked via the PHONE
  captured here.

**Known seams (logged, deferred — see CONTEXT carried-forward gaps):**
- *Fund-cash distortion:* all discharge cash routes to 1010/PI even though 4110/4130 are RDF
  income, so RDF earns income without matching RDF cash — deliberate simplification, resolved
  against real data at Phase 4/5 bank-rec.
- *Reconciliation seam:* discharge-balance cash (and refunds) post via `closeDeliveryBalance` on a
  different day than admission, OUTSIDE the daily wizard's income term — the daily reconciliation
  identity must account for advances-in (admission day) separately; discharge-day cash is a
  P2-T3d/e integration item.

---

## 4. EXPENSE MODEL — fund-first, with petty-cash voucher/cheque structure

### The form is FUND-FIRST (the manager picks first):
**1) PI (operating expense)** → Budget Category (CONTROLLED DROPDOWN) → 5000-series account:
| Budget Category | → Account |
|---|---|
| Salary & Wages | 5010 Salaries |
| Fringe & Benefits | 5020 Fringe Benefits |
| Fees, Honorarium & Allowances | 5030 Fees / Honorarium |
| General Administration | 5040 General Admin |
| Travel | 5050 Travel |
| Supplies & Equipment | 5060 Supplies |
| Purchased Services | 5070 Purchased Services |
*(Education 5080, Performance 5090 available; HQ-only: 5410 mgmt salaries, 5420 statutory — not
clinic-entered. R&M Building 5110 / Vehicle 5120, Depreciation 5130 — as applicable.)*
Posting: `Dr [expense account] / Cr [source: Petty Cash Float 1015 / Bank / Cash]`.

**2) RDF (stock purchase — NOT expense, Law 6)** → which stream:
| RDF stream | → Account (STOCK asset) |
|---|---|
| Medicine | 1210 RDF Stock – Medicines |
| Lab | 1220 RDF Stock – Lab |
| Logistic | 1230 RDF Stock – Logistic |
Posting: `Dr [RDF Stock 1210/1220/1230] / Cr [source]`. Becomes COGS (5210/5220/5230) at
month-end from the stock count — never operating expense. The fund choice makes this structural:
choosing RDF routes to stock by construction.

**3) Transfer** → Inter-clinic/HQ: `Dr/Cr 1410/2210`. Nets to zero; never P&L.

### Controlled dropdowns (a core ERP improvement over the Google Form)
Real data shows the same sub-category spelled many ways ("Motor Vehicle Maintenance" ×6,
"Refer Fees"/"Refer fees", "Fuel Cost"/"Fuel cost"). The form uses CONTROLLED category/
sub-category dropdowns — no free-text variants — so analysis by category is clean.

### Petty cash — reimbursement model + voucher/cheque structure (validated by real data)
Real data: rows under one voucher (e.g. #506) bundle several expenses paid together from petty
cash on one date. The model:
- **Float (1015)** = controlled cash fund with a running balance.
- **Reimbursement cheque:** `Dr 1015 / Cr Bank` — attributable (cheque number, named).
- **Each expense line:** `Dr [expense/stock account] / Cr 1015` — one posting per line, own
  category, own receipt. **Voucher number groups** lines paid together (one voucher → many lines).
  **Cheque number** links the bundle to its replenishment cheque.
- **Reimbursement sequence (Sayeed's actual practice):** expenses incurred from the standing
  float → a cheque reimburses them → voucher# + cheque# tie the bundle (auditable chain already
  in the current form: voucher#, cheque#, approver, receipt + cheque Drive links).
- **Per-cheque / per-voucher reconciliation** = a REPORT grouping lines by voucher#/cheque#,
  summing, flagging gaps ("Cheque #1234: Tk 20,000 issued, Tk 19,200 vouchers — Tk 800
  unaccounted"). Loose-coupling postings + reference fields make this a query, not a data object.

### Out-of-policy cash expense (the control problem) — exception path → APPROVAL
Managers are prohibited from spending the day's INCOME cash on expenses (creates skimming risk),
but reality forces it (e.g. after-hours ambulance repair > the ~20K float limit). The system
can't physically prevent it, but makes it **recorded, attributed, approval-gated:**
- An "out-of-policy cash expense" path records it: `Dr Expense / Cr Cash`, status
  **PENDING_APPROVAL** (reusing the engine's maker-checker). It's recorded (so cash reconciles)
  but NOT blessed until Sayeed approves — it can't silently become a normal posted expense.
- The "withdraw-from-PI-and-redeposit adjustment" is modeled explicitly as a **bank→cash
  replenishment** (`Dr Cash / Cr Bank`, named cheque) — not a zero-netting mystery transaction.
- **Unrecorded** cash spending is caught by the §2 reconciliation mismatch (physical count ≠
  expected). Principle: falsification is made detectable & costly, not impossible — HQ reads the
  flags.

### Audit chain (already in the current form — preserve it)
purchase date, payment date, category/sub-category (controlled), amount, vendor, voucher#,
cheque#, payment method, source-of-cash, bank account, receipt Drive link, cheque Drive link,
submitted-by, approved-by. The ERP keeps this chain structured + queryable and adds float-balance
tracking, reconciliation reports, and approval-gating.

---

## 5. STATISTICS STORE (operational data model) — LONG / TIDY (Q4 locked)

Grain: aggregate counts per day, per channel (session/team), per service type — NOT per-patient
(deferred to future patient modules; when they exist, counts can be DERIVED — store a `source`
flag MANUAL_AGGREGATE vs SYSTEM_DERIVED, mirroring the ledger's source_module).

**`daily_activity` table — one row per (entity, date, channel, service, metric) → value:**
```
entity=JAL date=2026-02-01 channel=MORNING service=OUTDOOR metric=patients_new value=1
entity=JAL date=2026-02-01 channel=MORNING service=OUTDOOR metric=services     value=79
entity=JAL date=2026-02-01 channel=TEAM_1  service=USG_PP  metric=usg_count    value=1
```
Dimensions: entity; date; channel (MORNING/EVENING/AFTERHOURS/STATIC/TEAM_n); service
(OUTDOOR/LAB/USG_*/NVD/CSECTION/…); metric (patients_new/old, services, lab_tests, usg_count,
cases). Enables free pivoting + the fused join to ledger income on entity+date+service.

---

## 6. REPORTS (Phase 4 — defined by this mapping)

- **Financial** — ledger only. Income by account/fund, per clinic + consolidated; R&P, I&E,
  Balance Sheet. RDF margin = Σ RDF sales − RDF COGS (observed).
- **Statistical** — statistics store only. Patients, services by type, USG by type, deliveries,
  satellite team performance; day → month; per clinic + consolidated.
- **Fused pivot** — join stats + ledger on entity+date(+service): "5 C-sections earned Tk X",
  "service A beat B", "Team 1 vs Team 2 per patient". The headline value of the design.
- **Executive summary (HQ/board)** — per-clinic snapshot, key figures + trends + exceptions,
  daily → monthly, for non-accountants.

---

## 7. Resolved decisions (Q1–Q5 + expense)
- **Q1 (revised per P2-T2b)** C-section: ADVANCE-HOLDING model. Advance held as a liability (2150)
  at admission, NOT income; the full itemized bill is income at discharge (`closeDeliveryBalance`,
  split 4030/4110/4130, 2150 released). No posted receivable (fee unknown/negotiable). Delivery
  tracker = OPEN/CLOSED follow-up with ageing nudge. "Safe Delivery" removed (parent grouping, not
  an income line — would double-count).
- **Q2** out-of-policy cash expense → PENDING_APPROVAL exception path; recon mismatch catches the
  unrecorded; redeposit modeled as explicit bank→cash replenishment.
- **Q3** one notional cash drawer, handled as PI (1010).
- **Q4** statistics store long/tidy.
- **Q5** deposits PI→1110, RDF→1120.
- **Expense** fund-first (PI operating 5000s / RDF stock 1210-1230 / Transfer 1410-2210);
  controlled dropdowns; petty-cash reimbursement w/ voucher#+cheque# reconciliation. Lab = RDF.

---

*Phase 2 canonical mapping v2 — LOCKED. Next: design the REVENUE WIZARD (steps follow §1 service
groups; per-clinic adaptive; dynamic satellite teams; save-draft + Revenue Entry Management page),
the EXPENSE FORM (§4 fund-first), the DELIVERY-BALANCE screen (§3), and the daily_activity stats
table (§5). Reports (Phase 4) per §6.*
