# Task Spec — P1-T6: Chart of accounts (requires_approval column + full §3 seed)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Sequencing note: this runs BEFORE the posting engine (the CONTEXT numbering had
> engine=T5, chart=T6, but the Build Plan's dependency order is accounts→transactions.
> The engine is built against this real chart afterward. Record this resequence in CONTEXT.

## Problem (one sentence)

The ledger needs its real chart of accounts (Blueprint §3) seeded as data, plus a
`requires_approval` flag on the accounts whose use must route an entry to maker-checker
approval regardless of amount.

## Output contract

One migration `supabase/migrations/0006_chart_of_accounts.sql`:

### Step 1 — add the column (append-only; do NOT edit 0001)

- `alter table public.accounts add column requires_approval boolean not null default false;`
- Comment: the engine (T5) routes an entry to PENDING_APPROVAL if ANY line's account has
  requires_approval = true (in addition to the value-threshold and is-reversal rules).

### Step 2 — seed the chart (idempotent: `on conflict (code) do nothing`)

Seed with SYSTEM actor `00000000-0000-0000-0000-000000000000`. **Shared chart** — each
account seeded ONCE; the entity tag on each transaction distinguishes clinics. Clinic
variants (C-Section, NVD, etc.) are all seeded; a clinic simply never posts to accounts
it doesn't use.

**`normal_balance` is set EXPLICITLY per row — never derived from `type`.** Note 1590
(Accumulated Depreciation) = type ASSET, normal_balance CREDIT (the contra-asset case).

**`fund` is NULL for the "any/—" accounts** — fund resolves on the line at posting time.

| code | name                                                  | type      | normal_balance | fund    | is_control | requires_approval |
| ---- | ----------------------------------------------------- | --------- | -------------- | ------- | ---------- | ----------------- |
| 1010 | Cash in Hand — PI                                     | ASSET     | DEBIT          | PI      | f          | f                 |
| 1015 | Cash — Petty Cash Float                               | ASSET     | DEBIT          | PI      | f          | f                 |
| 1020 | Cash in Hand — RDF                                    | ASSET     | DEBIT          | RDF     | f          | f                 |
| 1110 | SJIB Current — PI                                     | ASSET     | DEBIT          | PI      | f          | f                 |
| 1120 | SJIB SND — RDF                                        | ASSET     | DEBIT          | RDF     | f          | f                 |
| 1130 | AB Bank — HQ Operating                                | ASSET     | DEBIT          | HQ      | f          | f                 |
| 1140 | UCB — HQ                                              | ASSET     | DEBIT          | HQ      | f          | f                 |
| 1190 | EXIM STD — FROZEN                                     | ASSET     | DEBIT          | NULL    | f          | f                 |
| 1210 | RDF Stock — Medicines                                 | ASSET     | DEBIT          | RDF     | f          | f                 |
| 1220 | RDF Stock — Lab                                       | ASSET     | DEBIT          | RDF     | f          | f                 |
| 1230 | RDF Stock — Logistic                                  | ASSET     | DEBIT          | RDF     | f          | f                 |
| 1310 | Accounts Receivable (Control)                         | ASSET     | DEBIT          | NULL    | t          | f                 |
| 1320 | Patient Receivable — C-Section Balances               | ASSET     | DEBIT          | PI      | f          | f                 |
| 1410 | Inter-Clinic / HQ Loan Receivable (Control)           | ASSET     | DEBIT          | NULL    | t          | **t**             |
| 1510 | Fixed Assets — Furniture & Equipment                  | ASSET     | DEBIT          | NULL    | f          | f                 |
| 1520 | Investments — FDR / MIDS (Control)                    | ASSET     | DEBIT          | HQ      | t          | **t**             |
| 1530 | Leasehold / Building Improvements                     | ASSET     | DEBIT          | NULL    | f          | f                 |
| 1590 | Accumulated Depreciation                              | ASSET     | **CREDIT**     | NULL    | f          | f                 |
| 1610 | TB Care — SJIB (Restricted)                           | ASSET     | DEBIT          | TB_CARE | f          | f                 |
| 2010 | Accounts Payable — Suppliers (Control)                | LIABILITY | CREDIT         | RDF     | t          | f                 |
| 2110 | Salaries Payable                                      | LIABILITY | CREDIT         | PI      | f          | f                 |
| 2120 | Doctor / Consultant Fees & Allowances Payable         | LIABILITY | CREDIT         | PI      | f          | f                 |
| 2210 | Inter-Clinic / HQ Loan Payable (Control)              | LIABILITY | CREDIT         | NULL    | t          | **t**             |
| 2310 | Other Payables / Accruals                             | LIABILITY | CREDIT         | NULL    | f          | f                 |
| 2410 | TB Care — Funds Held / Rent Clearing                  | LIABILITY | CREDIT         | TB_CARE | f          | f                 |
| 3010 | Fund Balance — PI                                     | FUND      | CREDIT         | PI      | f          | **t**             |
| 3020 | Fund Balance — RDF                                    | FUND      | CREDIT         | RDF     | f          | **t**             |
| 3030 | Fund Balance — HQ-General                             | FUND      | CREDIT         | HQ      | f          | **t**             |
| 3040 | Fund Balance — TB Care (Restricted)                   | FUND      | CREDIT         | TB_CARE | f          | **t**             |
| 3900 | Inter-Fund Transfer (clearing)                        | FUND      | CREDIT         | NULL    | f          | **t**             |
| 4010 | PI — Outdoor                                          | INCOME    | CREDIT         | PI      | f          | f                 |
| 4020 | PI — NVD                                              | INCOME    | CREDIT         | PI      | f          | f                 |
| 4030 | PI — C-Section                                        | INCOME    | CREDIT         | PI      | f          | f                 |
| 4040 | PI — Satellite                                        | INCOME    | CREDIT         | PI      | f          | f                 |
| 4050 | PI — USG                                              | INCOME    | CREDIT         | PI      | f          | f                 |
| 4090 | PI — Other Income                                     | INCOME    | CREDIT         | PI      | f          | f                 |
| 4110 | RDF — Medicine Sales                                  | INCOME    | CREDIT         | RDF     | f          | f                 |
| 4120 | RDF — Lab                                             | INCOME    | CREDIT         | RDF     | f          | f                 |
| 4130 | RDF — Logistic                                        | INCOME    | CREDIT         | RDF     | f          | f                 |
| 4210 | Bank Interest (operating a/cs)                        | INCOME    | CREDIT         | NULL    | f          | f                 |
| 4220 | Investment Income — FDR/MIDS (gross)                  | INCOME    | CREDIT         | HQ      | f          | **t**             |
| 5010 | Salaries                                              | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5020 | Fringe Benefits                                       | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5030 | Fees / Honorarium                                     | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5040 | General Admin                                         | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5050 | Travel                                                | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5060 | Supplies                                              | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5070 | Purchased Services                                    | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5080 | Education                                             | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5090 | Performance                                           | EXPENSE   | DEBIT          | PI      | f          | f                 |
| 5110 | Repairs & Maintenance — Building                      | EXPENSE   | DEBIT          | NULL    | f          | f                 |
| 5120 | Repairs & Maintenance — Vehicle                       | EXPENSE   | DEBIT          | NULL    | f          | f                 |
| 5130 | Depreciation Expense                                  | EXPENSE   | DEBIT          | NULL    | f          | f                 |
| 5210 | RDF COGS — Medicines                                  | EXPENSE   | DEBIT          | RDF     | f          | f                 |
| 5220 | RDF COGS — Lab                                        | EXPENSE   | DEBIT          | RDF     | f          | f                 |
| 5230 | RDF COGS — Logistic                                   | EXPENSE   | DEBIT          | RDF     | f          | f                 |
| 5310 | Tax on Investment Income (20% at source)              | EXPENSE   | DEBIT          | HQ      | f          | f                 |
| 5410 | HQ Management Salaries (ED / CEO / Deputy CEO)        | EXPENSE   | DEBIT          | HQ      | f          | f                 |
| 5420 | Statutory & Compliance (VAT, Tax, Licence, Govt Fees) | EXPENSE   | DEBIT          | NULL    | f          | f                 |

(Codes/names for 4010–4090 and 5010–5090 confirmed by Sayeed. `fund` enum values: PI / RDF / HQ / TB_CARE.)

### No RLS / grant changes

`accounts` already has RLS + grants from T1. Adding a column doesn't change them. The
audit trigger already attached to `accounts` will log each seed insert (record_id = code).

## Relevant files (read before write)

- `IMAGE_Finance_System_Blueprint_v3.md` §3 (THE SOURCE OF TRUTH — verify every row against it)
- `supabase/migrations/0001_dimension_schema.sql` (accounts table, audit-column pattern)
- `supabase/tests/00_local_supabase_shim.sql`, `CONTEXT.md`, `LEARNINGS.md`

## Iron Laws in play

- L3 — seed inserts attributed (SYSTEM actor) + audited (existing accounts trigger).
- L4 — every account's fund tag correct; "any" accounts NULL (fund resolved on the line).

## Applicable LEARNINGS

- normal_balance stored separately from type (contra-asset 1590 = ASSET/CREDIT).
- Seeds need SYSTEM uuid (no auth.uid() at migration time).
- Idempotent seed: `on conflict (code) do nothing` so re-running is safe.
- Audit trigger logs by code for accounts (generic resolver, T3) — seeds will appear in audit_log.

## Done-criteria (the test `0006_chart_of_accounts_test.sql` must prove)

1. Exact account count seeded (count the rows in the table above) — assert count matches.
2. Spot-check a sample across types: 1010 (ASSET/DEBIT/PI), 1590 (ASSET/CREDIT — contra),
   2010 (LIABILITY/CREDIT/RDF/control), 4030 (INCOME/CREDIT/PI), 5210 (EXPENSE/DEBIT/RDF),
   4210 (fund IS NULL).
3. requires_approval = true on EXACTLY: 1410, 1520, 2210, 3010, 3020, 3030, 3040, 3900, 4220
   — and false on everything else. Assert both the true-set and a couple of false cases.
4. Idempotency: running the seed twice does not duplicate or error (on conflict do nothing).
5. Full regression: 0001(21)+0002(20)+0003(27)+0004(37)+0005(16) still green.

## On completion

End with exactly one status. Bring the diff + status back to the Architect for Iron-Law
review — Sayeed will eyeball the seeded chart against Blueprint §3 before commit.
Next: T6b (ledger index set, migration 0007), then T5 (posting engine).
