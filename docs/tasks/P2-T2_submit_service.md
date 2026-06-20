# Task Spec — P2-T2: Revenue-day submit service (one entry → ledger + statistics)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: the NestJS service that SUBMITS a revenue_day — reads its draft_data, posts the day's
> journal entries via the EXISTING posting engine, writes the daily_activity stat rows, flips the
> day to SUBMITTED — all in ONE transaction. NO UI (P2-T3+). NO schema changes (0011 is done). NO
> changes to the posting engine's core (it is REUSED as-is — the sole writer of journal_lines).
> This is the "one entry, two destinations" seam (Mapping §0).

## Problem (one sentence)
A manager makes ONE submission (a revenue_day in DRAFT with draft_data); the system must
deterministically translate it into the correct balanced journal entries (via the existing engine)
AND the daily_activity statistics rows, then mark the day SUBMITTED — atomically, idempotently,
with every posted figure COMPUTED from the entered numbers (Iron Law 1), never inferred.

## Reference (read before planning)
- `docs/.../Phase2_Revenue_Mapping_v2.md` — §1 (income line → account), §2 (cash/deposit flow),
  §0b (funds). THE spec for what posts where. Verify every mapping against it.
- `apps/api/src/ledger/ledger.service.ts` — the EXISTING posting engine: `postTransaction(input,
  actorId, isReversal?)`, integer-paisa balance check, `determineStatus`, SELECT FOR UPDATE
  pattern in `promoteEntry`. REUSE postTransaction; do not reimplement posting.
- `supabase/migrations/0011_revenue_entry_foundation.sql` — revenue_day + daily_activity shape,
  the DRAFT/SUBMITTED lifecycle, the direction guard, the daily_activity unique grain.
- `CONTEXT.md`, `LEARNINGS.md`.

## The draft_data contract (define + document — shared with the form in P2-T3)
The service reads this shape (the form in T3 must produce exactly it). Grounded in a real JAL day.
All money fields are BDT amounts (handled as integer paisa internally, per the engine). Counts are
integers. Per-clinic variation is natural (omit channels/sections that didn't run; satellite_teams
is a dynamic array; csection only present for JAL/NAS):

```json
{
  "revenue_date": "2026-02-02",
  "entity_code": "JAL",
  "channels_active": ["MORNING","EVENING","AFTERHOURS","SATELLITE","DELIVERY"],
  "sessions": {
    "MORNING":   { "patients_new":1,"patients_old":78,"services":79,
                   "service_charge":12550,"rdf_medicine_sales":8400,
                   "lab_tests":6,"lab_revenue":3200,
                   "usg":[{"type":"PP","count":3,"revenue":3600}] },
    "EVENING":   { "...":"same shape as MORNING" },
    "AFTERHOURS":{ "patients":4,"service_charge":1500,
                   "rdf_medicine_sales":900,"logistic_sales":300 }
  },
  "satellite_teams": [
    { "team":"TEAM_1","patients_new":2,"patients_old":39,"services":41,
      "service_charge":4100,"rdf_medicine_sales":2000,"lab_tests":2,"lab_revenue":900,
      "usg":[{"type":"PP","count":1,"revenue":1200}] }
  ],
  "delivery": {
    "nvd":          { "cases":1,"service_charge":3000,"rdf_revenue":900,"logistic_revenue":200 },
    "csection":     { "cases":0,"service_charge":0,"rdf_revenue":0,"logistic_revenue":0,
                      "balances":[ /* {receipt_no, patient_name, phone, advance, expected_balance, expected_date} */ ] },
    "safe_delivery":{ "rdf_revenue":0,"logistic_revenue":0 }
  },
  "other_income": [ /* {description, amount} */ ],
  "financial": {
    "bank_deposit":  { "made":true,"pi_amount":124000,"rdf_amount":0 },
    "cash_advance":  { "amount":0,"fund":null,"description":null },
    "cash_in_hand_counted": 5189,
    "reconciliation_notes": null
  }
}
```
**Validate draft_data with Zod** (server-side) before processing. Reject malformed/negative
amounts. (The form will validate too, but the service must not trust the client.)

## What submit does (one DB transaction)
`submitRevenueDay(revenueDayId, actorId)`:

1. **SELECT FOR UPDATE the revenue_day** (lock it). Guard: must exist, status MUST be 'DRAFT'
   (a SUBMITTED day cannot be re-submitted — idempotency). Reject otherwise. (Mirror promoteEntry's
   lock-then-check pattern.)
2. **Validate draft_data (Zod).**
3. **Compute the postings deterministically (Iron Law 1 — pure arithmetic over draft_data):**
   The system decomposes the ONE manager submission into SEPARATE balanced journal entries per
   economic event (the manager never sees this; "the system distributes it as it sees fit"):

   **(i) INCOME entry** — `Dr Cash / Cr [income accounts]`. Sum across all channels + teams per
   account, per Mapping §1:
   - 4010 PI-Outdoor ← all sessions' + after-hours service_charge
   - 4040 PI-Satellite ← all teams' service_charge
   - 4050 PI-USG ← all usg[].revenue (all types, all channels/teams)
   - 4020 PI-NVD ← nvd.service_charge · 4030 PI-C-Section ← csection.service_charge
   - 4090 PI-Other ← Σ other_income[].amount
   - 4110 RDF-Medicine ← all rdf_medicine_sales + nvd/csection/safe rdf_revenue
   - 4120 RDF-Lab ← all lab_revenue · 4130 RDF-Logistic ← after-hours logistic + nvd/csection/safe logistic
   - Debit side — **DECISION (locked): cash split by fund, RDF cash stays notional.**
     `Dr 1010 Cash-PI` ← the PI income portion (sum of all PI-fund credits: 4010/4040/4050/4020/
     4030/4090); `Dr 1020 Cash-RDF` ← the RDF income portion (sum of all RDF-fund credits:
     4110/4120/4130). So each fund's cash debit EQUALS its own income credits — the funds stay
     clean (RDF fund's cash asset matches its income; PI likewise). Physically one drawer, but
     booked PI vs RDF notionally (matches the form already tracking PI/RDF deposits separately).
   - The entry must balance (Σ debit = Σ credit): (PI cash debit = Σ PI income) AND (RDF cash
     debit = Σ RDF income), so the whole entry balances. The engine enforces; the service produces
     balanced, fund-correct lines.

   **(ii) DEPOSIT entry (only if bank_deposit.made)** — SEPARATE entry, independent of income
   (Mapping §2: the deposit may carry several days' accumulated cash; never reconciled to today's
   income). `Dr 1110 Bank-PI ← pi_amount / Cr 1010 Cash-PI`; `Dr 1120 Bank-RDF ← rdf_amount /
   Cr 1020 Cash-RDF` (PI deposit draws PI cash, RDF deposit draws RDF cash — fund-clean). Balanced.

   **(iii) CASH ADVANCE entry (only if cash_advance.amount > 0)** — SEPARATE.
   `Dr Petty Cash Float (1015) / Cr Cash` — drawn from the fund's cash given in cash_advance.fund
   (1010 Cash-PI by default; 1020 Cash-RDF only if explicitly RDF — managers normally avoid RDF).
   (The expense itself is recorded separately via the expense form — this is just the advance
   movement, per Mapping §4.)

   Each entry posted via `postTransaction`, `source_module='REVENUE_ENTRY'`, `source_id=
   revenueDayId`, entry_date = revenue_date, actor = actorId. (determineStatus applies as normal —
   most will be POSTED; if any line hits a requires_approval account or the value threshold, that
   entry routes PENDING_APPROVAL per the existing engine. Note: this is fine and expected.)

4. **Write daily_activity rows (the COUNTS)** — long/tidy, one row per
   (entity, date, channel, service, metric). Upsert on the unique grain (re-derivable). e.g.
   MORNING/OUTDOOR/patients_new, MORNING/OUTDOOR/services, MORNING/LAB/lab_tests,
   MORNING/USG_PP/usg_count, TEAM_1/OUTDOOR/services, STATIC/NVD/cases, etc. value from draft_data.
   source='MANUAL_AGGREGATE'. revenue_day_id = revenueDayId. Written via the service connection
   (service_role — daily_activity has no authenticated write, per 0011).
5. **Record the delivery balances (csection/safe_delivery balances[])** — per Mapping §3, the
   MEMO/ageing tracker (NOT posted receivables — Q1 cash basis). **DECISION (locked): include a
   minimal `delivery_balance` table in THIS task (a small migration 0012).** Shape:
   - `id uuid pk`, `entity_id uuid not null → entities`, `revenue_day_id uuid → revenue_day`,
     `receipt_no text`, `patient_name text`, `phone text`, `delivery_type text` (CSECTION/SAFE),
     `advance_paid numeric(15,2)`, `expected_balance numeric(15,2)`, `expected_date date`,
     `status text check (status in ('OPEN','CLOSED')) default 'OPEN'`, `closed_date date`,
     audit columns + require_actor/touch/audit triggers + entity-scoped RLS (ENTRY writes own
     entity; reads scoped). These are structured reference fields, NOT a patient record (phone =
     future bridge). NOT a posted receivable — the advance/balance are recorded as income when
     paid (cash basis), this table tracks the OPEN balance for the ageing nudge only.
   - Submit writes a `delivery_balance` row (OPEN) for each entry in csection.balances[]. Recording
     a later balance payment (a future day's entry, or a dedicated action) marks it CLOSED + posts
     that payment as income — the close action can be P2-T2b/P2-T3; T2 creates the table + the
     OPEN-on-submit write. Note the ageing view + balance-payment-close UI is a later UI task.
6. **Flip revenue_day → SUBMITTED**: set status='SUBMITTED', journal_entry_id (the income entry's
   id — the primary link), total_revenue (computed day total), submitted_at=now().
7. **All in ONE transaction** — if ANY step fails (unbalanced, engine error, constraint), the
   WHOLE thing rolls back: no partial submit, no orphan entries, day stays DRAFT.

## Determinism & integrity (Iron Laws)
- **L1:** every posted figure = arithmetic over draft_data. No Claude/AI call anywhere in submit.
- **L2:** each entry balanced; only the engine writes journal_lines (the service CALLS postTransaction).
- **L3:** actor stamped (actorId), audited.
- **L4:** every journal line carries entity + fund (fund per-line, per Mapping §0b/§1); every
  daily_activity row carries entity.
- The income entry's cash debit total MUST equal the income credits total (the day's cash income).
  The deposit/advance entries balance independently. If the manager's stated total_revenue (a check
  figure) disagrees with the computed sum, the service uses the COMPUTED sum (deterministic) and
  MAY record the discrepancy — discuss in plan (probably: compute authoritative, flag mismatch).

## Idempotency
- Only a DRAFT day submits (SELECT FOR UPDATE + status check). Re-calling on a SUBMITTED day →
  rejected (no double-post). daily_activity upsert on the unique grain means re-derivation is safe
  even if step 4 partially ran in a prior failed attempt (but the whole txn rolls back anyway).

## Tests (Jest, against a test DB — mirror the engine's existing test setup)
1. A full JAL day's draft_data submits: produces the income entry (correct accounts/amounts,
   balanced), a deposit entry, daily_activity rows at the right grain; day → SUBMITTED with
   journal_entry_id + total_revenue set.
2. A holiday/partial day (only delivery channel) submits correctly (no morning/evening lines).
3. A zero day (closed) submits (zero total, no income lines, or a no-op income entry — decide).
4. Re-submitting a SUBMITTED day is REJECTED (idempotency).
5. An unbalanced/invalid draft_data is REJECTED, the whole txn rolls back, day stays DRAFT, no
   journal entry or daily_activity rows created.
6. Determinism: the same draft_data always yields the same postings/stats (no nondeterminism).
7. fund-per-line correct (RDF credits carry RDF, cash debit carries PI); income entry balances.
8. Existing engine tests (45) + all migration suites still green.

## On completion
End with exactly one status — do NOT commit; Architect review + Sayeed verify (read the produced
journal entries + daily_activity for a real day and confirm they match the mapping), then commit +
push. Next: P2-T3 — the UI (Revenue Entry Management page + the wizard producing this exact
draft_data + the review/submit screen calling submitRevenueDay).
