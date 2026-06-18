# IMAGE Finance System — Design Blueprint (v3 · spine closed)

A custom **double-entry** accounting system. **One transaction ledger is the single source of truth.** A manager records each revenue or expense once, with full detail; every report, balance, and reconciliation is a deterministic query over the accumulated transactions. Simple to enter; rich underneath. Code computes every figure.

---

## 1. Scope & dimensions

- **Funds (4):** `PI` · `RDF` · `HQ-General` · `TB Care` *(restricted — excluded from operating totals)*
- **Entities / tags (6):** 5 clinics + `HQ`. Codes: **JAL** = Jalalabad · **NAS** = Nasirabad · **AMB** = Amanbazar · **KAT** = Kattali · **CHA** = Chandgaon
- **In scope:** PI, RDF, HQ — the funds IMAGE controls and reports.
- **Ring-fenced:** TB Care — organizationally IMAGE, reported to BRAC by the TB Care team. Carried as a *disclosed restricted fund*; its internal bookkeeping stays with the team; we never reproduce its ledger.

---

## 2. Data model (entities)

| Entity | Holds | Key fields |
|---|---|---|
| **Clinic / Entity** | 5 clinics + HQ | id, name, code |
| **Account** | the chart of accounts | code, name, type, normal_balance, fund, is_control, **active** |
| **Party** | vendors, debtors, instruments | id, name, kind, control_account, contact, **active** |
| **Fixed Asset** | each capitalised item | id, name, entity, **class**, **purchase_date**, cost, accum_depr |
| **Journal Entry** | one transaction (header) | id, date, entity, fund, description, ref, entered_by |
| **Journal Line** | the postings | entry_id, account_code, party_id (nullable), debit, credit |
| **Bank Feed** | SMS-tracker balances (independent) | account, date, statement_balance |
| **Setting** | adjustable config | capitalisation_threshold, asset-class rates, residual, fiscal year |

**Iron rule:** within every entry, `Σ debit = Σ credit`. The manager never sees Dr/Cr — a simple form generates the posting from a template.

---

## 3. Chart of Accounts

### Assets (1000s · Debit)
| Code | Account | Fund | Notes |
|---|---|---|---|
| 1010 / 1020 | Cash in Hand — PI / RDF | PI / RDF | per clinic |
| 1015 | Cash — Petty Cash Float | PI | replenishment = bank→float transfer |
| 1110 / 1120 | SJIB Current — PI / SJIB SND — RDF | PI / RDF | per clinic |
| 1130 | AB Bank — HQ Operating | HQ | interest in; salaries, VAT/tax/licence out |
| 1140 | UCB — HQ | HQ | |
| 1190 | EXIM STD — FROZEN | (clinic) | disclosed; excluded from usable cash |
| 1210 / 1220 / 1230 | RDF Stock — Medicines / Lab / Logistic | RDF | purchases land here, not in expense |
| 1310 | **Accounts Receivable (Control)** | — | subsidiary per debtor |
| 1320 | Patient Receivable — C-Section Balances | PI | lumped; per-patient when EHR/POS connects |
| 1410 | **Inter-Clinic / HQ Loan Receivable (Control)** | — | subsidiary per entity |
| 1510 | Fixed Assets — Furniture & Equipment | (any) | capital ≥ threshold; carries class + date |
| 1530 | **Leasehold / Building Improvements** | (any) | capital renovations (e.g. Kattali fit-out) |
| 1590 | **Accumulated Depreciation** *(contra-asset, Credit)* | — | written-down value = cost − this |
| 1520 | **Investments — FDR / MIDS (Control)** | HQ | subsidiary per instrument |
| 1610 | TB Care — SJIB (Restricted) | TB Care | disclosed; balance from team's report |

### Liabilities (2000s · Credit)
| Code | Account | Fund | Notes |
|---|---|---|---|
| 2010 | **Accounts Payable — Suppliers (Control)** | RDF | subsidiary per vendor |
| 2110 | Salaries Payable | PI | accrual |
| 2120 | Doctor / Consultant Fees & Allowances Payable | PI | accrual — the late-cheque view |
| 2210 | **Inter-Clinic / HQ Loan Payable (Control)** | — | subsidiary per entity |
| 2310 | Other Payables / Accruals | — | |
| 2410 | TB Care — Funds Held / Rent Clearing | TB Care | the only live TB Care seam |

### Equity / Funds (3000s · Credit)
| Code | Account |
|---|---|
| 3010 / 3020 / 3030 | Fund Balance — PI / RDF / HQ-General |
| 3040 | Fund Balance — TB Care (Restricted) |
| 3900 | Inter-Fund Transfer (clearing) |

### Income (4000s · Credit)
| Code | Account | Fund |
|---|---|---|
| 4010–4090 | PI — Outdoor / NVD / C-Section / Satellite / USG / Other | PI |
| 4110 / 4120 / 4130 | RDF — Medicine Sales / Lab / Logistic | RDF |
| 4210 | Bank Interest (operating a/cs) | RDF / HQ |
| 4220 | Investment Income — FDR/MIDS (gross) | HQ |

### Expenses (5000s · Debit)
| Code | Account | Fund |
|---|---|---|
| 5010–5090 | Salaries · Fringe · Fees/Honorarium · Gen Admin · Travel · Supplies · Purchased Services · Education · Performance | PI |
| 5110 / 5120 | Repairs & Maintenance — Building / Vehicle | any |
| 5130 | **Depreciation Expense** | any |
| 5210 / 5220 / 5230 | RDF COGS — Medicines / Lab / Logistic | RDF (month-end) |
| 5310 | Tax on Investment Income (20% at source) | HQ |
| 5410 | HQ Management Salaries (ED / CEO / Deputy CEO) | HQ |
| 5420 | Statutory & Compliance (VAT, Tax, Licence, Govt Fees) | any |

---

## 4. How simple entries post (manager never sees this)

- **Cash revenue → deposit:** Cr Income / Dr Cash; then Dr Bank / Cr Cash.
- **Drug purchase on credit (Renata):** Dr RDF Stock / Cr AP–*Renata*; clears when paid.
- **Salary/doctor fee (accrual):** earned → Dr Expense / Cr Payable; cheque cashed → Dr Payable / Cr Bank. Unpresented cheques = the open payable.
- **Petty cash:** replenish Dr Float / Cr Bank; spend Dr Expense / Cr Float. No double-count.
- **Investment interest (20% at source):** Dr Bank (80%) + Dr Tax on Investment Income (20%) / Cr Investment Income (gross).
- **Inter-clinic / HQ transfer:** Dr Inter-Clinic Receivable / Cr Bank (sender); mirror at receiver. Nets to zero.
- **Renovation — the per-case choice:** repair → Dr R&M Building (5110) / Cr Bank (expense now); capital fit-out → Dr Leasehold Improvements (1530) / Cr Bank (asset, depreciates).
- **TB Care rent via clinic:** Dr Bank / Cr TB Care Funds Held on receipt; reverse on payment. Clinic is a conduit, never owner.

---

## 5. Subsidiary ledgers & drill-down

Control → subsidiaries, balance always = sum of parts:
- **Accounts Payable (2010)** → per vendor → history & balance owed.
- **Investments (1520)** → per FDR/MIDS → principal, rate, maturity, interest.
- **Receivables (1310) / Inter-clinic (1410, 2210)** → per party.

---

## 6. Period-end & reconciliation (automated postings)

- **Monthly — RDF COGS** from the stock count: `Dr COGS / Cr RDF Stock` for (Opening + Purchases − Closing). *(Future: inventory module's closing count feeds this automatically.)*
- **Annual — Depreciation:** `Dr Depreciation Expense (5130) / Cr Accumulated Depreciation (1590)`, system-computed as class rate × cost, **straight-line, zero residual**. No manager effort.
- **Cashbook vs bank — live:** ledger bank balance vs SMS Bank Feed; gap = deposits-in-transit + unpresented cheques. Any day.

---

## 7. Decisions locked

1. **Patient receivables:** lumped (1320); per-patient deferred to EHR/POS.
2. **Inventory:** periodic — purchases → stock asset; COGS monthly from count.
3. **Depreciation:** **straight-line, annual, depreciated to zero residual, by asset class** (rates below, held in settings).
4. **Capitalisation threshold:** default Tk 10,000 — adjustable setting.
5. **Accrual:** salaries, doctor fees & allowances booked payable-when-earned; other expenses cash-basis.

### Asset-class depreciation rates (settings — straight-line)
| Class | Useful life | Rate |
|---|---|---|
| Furniture & Fixtures | 10 yr | 10% |
| Medical / Lab Equipment | ~7 yr | 15% |
| Computer / IT Equipment | 4 yr | 25% |
| Vehicles | 5 yr | 20% |
| Building (structure) | 20 yr | 5% |
| Renovation / Leasehold Improvements | 10 yr | 10% |

*Note: these are IAS 16 useful-life estimates for financial reporting. Bangladesh tax depreciation (reducing-balance, NBR Third Schedule) is a separate computation, only needed if a tax filing requires it.*

---

## 8. Design principle — adaptable chart of accounts

Chart of accounts and parties are **data, not code**, edited through an admin panel.

- **Add freely:** accounts, sub-accounts, vendors, debtors, instruments, clinics.
- **Deactivate, don't delete:** anything with a transaction is archived (hidden from dropdowns, history preserved). Only never-used items hard-delete.
- **Locked once used:** an account's *type* and *normal balance* (changing them rewrites history).
- **Settings:** capitalisation threshold, asset-class rates, residual value, fiscal year.

---

## 9. Open / deferred (not blocking)

- **Inventory module + connection** (the COGS seam) — own scope decision after finance forms.
- **Investment data refresh** — FDR/MIDS maturities stale (snapshot 18 Feb 2026); refresh from new statements before go-live.
- **Stack & hosting** — app + database (NestJS/Postgres direction); clinic connectivity and entry location decided at build time.
- **Pilot:** one clinic (Jalalabad / Mohsin), one full month, before rollout.
