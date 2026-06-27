# P2-T4a — Core Expense Form (task spec)

**Phase 2 · the other half of manager entry.** A fund-first expense-entry form that posts to the
ledger. PI → operating expense (5000s); RDF → stock purchase (1210/1220/1230, NOT expense — Law 6);
Transfer → inter-clinic/HQ (1410/2210). Controlled category dropdowns (the clean-data improvement
over the free-text Google Form), a source-of-funds choice (Petty Cash Float 1015 / Bank / Cash 1010),
and the structured audit chain (voucher#, cheque#, vendor, dates, payment method). Posts through the
SAME engine the revenue wizard uses — the engine is the sole writer of journal_lines.

**Authorities:** `docs/tasks/Phase2_Revenue_Mapping_v2.md` §4 (the EXPENSE MODEL — canonical; do NOT
derive account routing, fund logic, or category→account from anywhere else); the posting engine
(submitRevenueDay / postTransactionOnClient pattern — reuse it, don't write journal_lines directly);
the money/count validation helpers (strToMoney/sanitizeMoney/parseMoneyField — built in the
comma-corruption fix, REUSE them); the ManagerShell + wizard house style. On conflict, flag.

---

## 1. The problem (one sentence)
A manager needs to record an expense — fund-first so the routing is correct by construction — with
clean controlled categories and the voucher#/cheque# audit chain, posting a balanced
`Dr [routed account] / Cr [source]` entry through the engine.

## 2. The FUND-FIRST fork (the spine — §4)
The manager picks the FUND FIRST; that choice determines the debit account by construction:

**PI (operating expense)** → Budget Category (CONTROLLED DROPDOWN) → 5000-series:
| Budget Category | Account |
|---|---|
| Salary & Wages | 5010 |
| Fringe & Benefits | 5020 |
| Fees, Honorarium & Allowances | 5030 |
| General Administration | 5040 |
| Travel | 5050 |
| Supplies & Equipment | 5060 |
| Purchased Services | 5070 |
*(Education 5080, Performance 5090 selectable if applicable; R&M Building 5110 / Vehicle 5120 /
Depreciation 5130 as applicable. HQ-only 5410/5420 are NOT clinic-entered — exclude from the
clinic-manager dropdown.)*
Posting: `Dr [5000 expense] / Cr [source]`.

**RDF (stock purchase — NOT expense, Law 6)** → stream → STOCK asset account:
| RDF stream | Account |
|---|---|
| Medicine | 1210 RDF Stock – Medicines |
| Lab | 1220 RDF Stock – Lab |
| Logistic | 1230 RDF Stock – Logistic |
Posting: `Dr [1210/1220/1230 stock] / Cr [source]`.

**Transfer** → inter-clinic/HQ: `Dr/Cr 1410/2210` (nets to zero; never P&L).

### THE LAW-6 GUARANTEE (the central correctness property — non-negotiable)
Choosing RDF routes to a STOCK asset account (1210/1220/1230) BY CONSTRUCTION. An RDF purchase must
be STRUCTURALLY INCAPABLE of booking to a 5000-series operating expense. The fund-first fork enforces
this: pick RDF → the 5000 category dropdown is never shown; you get the three stock streams only.
There is no code path, no fallback, no "other" that lets an RDF purchase land in a 5xxx expense. This
is the form's most important property — verify it cannot be bypassed (including via stale state if the
manager switches fund after partly filling the form: switching fund must reset the routed account).

## 3. Source of funds (the credit side)
A controlled choice — where the money came from:
- **Petty Cash Float (1015)** — the standing float; the primary/default for routine clinic expenses.
- **Bank** — direct bank payment (cheque/transfer).
- **Cash (1010)** — the notional cash drawer (PI). NOTE: paying an expense from 1010 day-income cash
  is the "out-of-policy" case — but the APPROVAL-GATING of that is a SEPARATE later task (T4c). For
  THIS task, Cash is a selectable source posting normally; do not build the PENDING_APPROVAL path
  here. (Flag in the spec that out-of-policy approval is deferred — see §7.)
Posting credit = the chosen source account. `Dr [routed] / Cr [source]`.

## 4. Controlled dropdowns (the clean-data win — §4)
Real Google Form data had the same sub-category spelled many ways ("Fuel Cost"/"Fuel cost", "Refer
Fees"/"Refer fees", "Motor Vehicle Maintenance" ×6 variants). The form uses CONTROLLED
category (and sub-category where the mapping defines them) dropdowns — NO free-text category — so
analysis by category is clean. Category options come from the §4 budget-category → account table
(the controlled list), NOT free text. (If sub-categories aren't yet enumerated in the mapping for a
category, a controlled list can be a follow-up; the category→account level is the must.)

## 5. The audit chain (structured fields to capture — §4, preserve the current form's chain)
Capture as STRUCTURED fields (not free-text blobs, not file uploads):
- purchase date, payment date
- category / sub-category (controlled — §4)
- amount (money input — REUSE the validation helpers; strip commas, no type=number)
- vendor (text — validated non-empty where required)
- **voucher#** (MUST field — the audit-chain link that groups lines paid together)
- **cheque#** (MUST field where payment is by cheque — links the bundle to its replenishment cheque)
- payment method, source-of-cash (the §3 source), bank account (where relevant)
- submitted-by (the manager — from session)
NO receipt/cheque file upload, NO Drive-link URL fields (decided: voucher#/cheque# are the structured
links; physical scans live outside the ERP — uploads clutter storage for a mild nice-to-have).

## 6. Posting (through the engine — Law 1, Law 2)
- The form computes NOTHING about the ledger itself — it gathers the inputs and calls the posting
  service, which constructs the balanced `Dr [routed account] / Cr [source]` entry. The engine is
  the SOLE writer of journal_lines (never write journal_lines from the form/route directly).
- Entity tag on the posting = the manager's entity (every transaction carries its entity — Law 4).
- Fund tag follows the fund-first choice (PI / RDF stream).
- Σdebit = Σcredit enforced by the engine (single integer-paisa rounding — reuse the money helpers'
  paisa discipline; do NOT reintroduce sum-of-rounds divergence).
- Amount parsing: REUSE strToMoney/parseMoneyField — strip ALL commas before parse (BD lakh format),
  never type=number for the amount input. (This is the corruption-fix discipline — non-negotiable.)
- voucher#/cheque# stored as reference fields on the posting (journal_entry metadata) so the future
  reconciliation report (Phase 4) can group by them — "query, not data object" (§4).

## 7. What stays out (explicitly deferred — separate tasks)
- **Reimbursement-cheque posting** (`Dr 1015 / Cr Bank` — replenishing the float). Different
  transaction type, arguably a finance/admin action not a clinic-manager expense. → T4b.
- **Out-of-policy approval path** (paying from day-income Cash → PENDING_APPROVAL maker-checker). →
  T4c (may share an approval surface with the deferred submitted-day correction/reversal flow,
  issue #5 — design the approval surface once). For THIS task, Cash-as-source posts normally.
- **Voucher/cheque reconciliation reports** (grouping lines by voucher#/cheque#, flagging gaps). →
  Phase 4 (it's a query over the postings, not part of entry).
- **Sub-category controlled lists** where the mapping hasn't enumerated them yet (category→account is
  the must; sub-category enumeration can follow).
- **The gate** does NOT apply to expenses (the completeness gate is revenue-day specific). Confirm
  expense entry is not accidentally gated.

## 8. Tests / verification
- Fund-first routing: PI + each budget category → correct 5000 account; RDF + each stream → correct
  1210/1220/1230; Transfer → 1410/2210. Each posts `Dr [routed] / Cr [source]`, balanced.
- LAW-6 (the critical test): RDF purchase CANNOT route to a 5000 account — no UI path, and switching
  fund from PI→RDF (or back) after partly filling resets the routed account (no stale 5xxx leaking
  into an RDF post). Assert an RDF posting's debit account is always 12xx, never 5xxx.
- Source: each source (1015/Bank/1010) credits the correct account.
- Amount parsing: "15,000" posts 15000 (not 15) — the comma-corruption regression test, REUSING the
  helpers. ">2dp / non-numeric" rejected.
- voucher#/cheque# captured and stored on the entry; MUST-field validation (voucher# required;
  cheque# required when payment method = cheque).
- Engine balance: Σdr = Σcr (single paisa rounding); the engine rejects an unbalanced attempt.
- Entity + fund tags correct on the posting.
- Controlled category dropdown (no free text); HQ-only categories (5410/5420) excluded from the
  clinic dropdown.
- Browser (Sayeed): post a PI Travel expense from the float → Dr 5050 / Cr 1015, balanced, shows in
  the ledger with voucher#; post an RDF Medicine purchase → Dr 1210 / Cr [source] (NOT a 5xxx);
  switch fund mid-form and confirm the routed account resets; a "15,000" amount posts 15000; confirm
  expense entry is NOT gated.

## 9. Definition of done
A fund-first expense form posts balanced `Dr [routed account] / Cr [source]` entries through the
engine — PI→5000s, RDF→stock 12xx (structurally never a 5xxx, the Law-6 guarantee), Transfer→1410/2210
— with controlled category dropdowns, a source-of-funds choice (float 1015 / Bank / Cash 1010), and
the structured audit chain (voucher#/cheque# must-fields, vendor, dates, payment method), reusing the
money-validation helpers. Out-of-policy approval, reimbursement-cheque posting, and reconciliation
reports are deferred. Then: CONTEXT.md session block. Do NOT commit until Sayeed browser-verifies.

---

### Plan-first
Return a plan: the form structure (fund-first fork → routed account; source-of-funds; controlled
category dropdown; audit-chain fields); how the routed account is derived BY CONSTRUCTION from fund
(and reset on fund-switch — the Law-6 guarantee); the posting service call (reusing the engine, not
writing journal_lines directly) and how voucher#/cheque# attach to the entry; reuse of the money
helpers; what's a new route vs reused; and the test list (with the Law-6 RDF-can't-be-5xxx test and
the comma regression test called out). Confirm the engine is the sole journal_lines writer. Wait for
approval. Do not commit.
