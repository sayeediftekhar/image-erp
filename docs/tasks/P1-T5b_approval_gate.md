# Task Spec — P1-T5b: Approval gate (determineStatus)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: replace the body of `determineStatus()` only. postTransaction, checkBalance,
> writeEntry, the Zod schema, the DI setup — all untouched. NOT in this task: reverseEntry
> (T5c). T5b builds the reversal CHECK so the gate is ready, but reverseEntry itself is T5c.

## Problem (one sentence)

An entry must route to `PENDING_APPROVAL` instead of `POSTED` when it is high-value, touches
an approval-flagged account, or is a reversal — so the risky few wait for Sayeed's approval
while routine entries post directly (Law 4: don't gate routine flow).

## The rule

`determineStatus()` returns `'PENDING_APPROVAL'` if ANY of:

1. **Value threshold** — the entry total (Σdebit, in integer paisa) ≥ the
   `high_value_approval_threshold` from `settings`. Read from the DB at decision time, NOT
   hardcoded (it's a setting; admin can change it). Compare in integer paisa, never float.
2. **Flagged account** — any line's `accountCode` belongs to an account with
   `requires_approval = true`. (The 9 flagged accounts: 1410, 1520, 2210, 3010, 3020, 3030,
   3040, 3900, 4220.)
3. **Reversal** — the entry is a reversal. T5c will pass this in; for T5b, accept a flag/field
   on the input or a parameter so the check exists and is testable now. (Decide the cleanest
   signal in the plan — e.g. a `reverses` boolean the engine sets, not a user input.)

Otherwise `'POSTED'`.

## Notes

- `determineStatus` currently takes the parsed input. It now also needs to read `settings`
  and `accounts.requires_approval` — so it needs DB access (the same pool). Keep the method
  the single place status is decided; it may become `async` (postTransaction awaits it).
- Reading the threshold + the flagged-account check are two small queries. One combined query
  is fine (e.g. fetch the threshold once; check if any of the entry's account_codes have
  requires_approval = true in one `WHERE code = ANY($1) AND requires_approval`).
- Threshold value from `settings` is jsonb — parse it to an exact number (integer paisa
  comparison), per the NUMERIC-as-string LEARNING.
- The check must use Σdebit (= Σcredit, already balanced) as the entry total.

## Iron Laws in play

- L4 — adoption: gate only the risky few, routine entries post directly.
- L1 — the threshold is data (settings), not a magic number in code.

## Applicable LEARNINGS

- settings.value is jsonb; read exactly, no float.
- Integer-paisa comparison (same as the T5 balance check) for the threshold test.

## Done-criteria (tests, local Postgres + Jest — extend ledger.service.spec.ts)

1. Below threshold, no flagged account, not a reversal → `POSTED` (the routine case still works).
2. Total ≥ threshold → `PENDING_APPROVAL`. (Use a total just over 50,000; and test a value
   just under stays POSTED — boundary both sides.)
3. A line touching a flagged account (e.g. 1520 Investments or 3010 Fund Balance) →
   `PENDING_APPROVAL`, even when total is small.
4. A reversal → `PENDING_APPROVAL` regardless of amount.
5. Threshold is read from settings, not hardcoded: change the setting value in the DB within
   a test, post an entry that crosses the NEW threshold, confirm routing follows the changed
   value. (Proves it's data-driven.)
6. Money: a total exactly AT the threshold boundary routes per the ≥ rule (paisa-exact, no
   float drift at the boundary).
7. All T5 core tests still green (determineStatus change didn't break posting).

## On completion

End with exactly one status. Bring diff + status back to the Architect.
Next: T5c (reverseEntry — builds the actual reversal that the gate's reversal-check serves).
