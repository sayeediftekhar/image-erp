# Task Spec — P1-T5: Core posting engine (postTransaction)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: the CORE engine only. NOT in this task: the approval gate (T5b), reverseEntry
> (T5c). T5 posts a balanced entry, checks balance in code, stamps the real actor, sets
> status. Keep it that narrow.

## Problem (one sentence)

Build `postTransaction()` — the single function that writes a balanced journal entry
(header + lines) to the ledger; nothing else writes journal lines (Law 2).

## Setup (first real app code)

- Scaffold a NestJS app at `apps/api` (pnpm). Keep the repo a pnpm monorepo: migrations
  stay in `supabase/`, app code in `apps/api`.
- Jest for tests.
- DB access: a Postgres client (node-postgres `pg`). Connection string from env
  (`DATABASE_URL`). **Tests use a LOCAL Postgres** (same rig as the SQL tests); production
  uses Supabase. The engine connects on the **service_role** connection (BYPASSRLS) — it is
  the sole writer (Law 2). **Service key / service connection string is server-only, never
  shipped to any frontend.**
- Zod for input validation.

## The function — `postTransaction(input, actorId)`

**Input (Zod-validated before anything else):**

- `entityId: uuid`
- `entryDate: string` (date — the stated transaction date)
- `description: string` (non-empty)
- `ref?: string`
- `sourceModule?: string` (default 'MANUAL')
- `sourceId?: uuid`
- `lines: Array<{ accountCode: string; fund: 'PI'|'RDF'|'HQ'|'TB_CARE'; debit: number; credit: number; partyId?: uuid }>`
    - at least 2 lines
    - each line: exactly one of debit/credit > 0 (the other 0), no negatives

**`actorId: uuid`** — the authenticated user who triggered this (the manager/accountant).
Passed in explicitly; stamped as `created_by` on entry and lines. The engine writes on the
service connection, but the ACTOR is the real user, never the service role (Law 3).

**Behaviour:**

1. Validate input with Zod. Reject with a clear error if malformed.
2. **In-code balance check:** Σdebit == Σcredit across lines. If not, throw a clear error
   (e.g. "entry unbalanced: debit 5000 ≠ credit 4800") BEFORE touching the DB. This is the
   friendly early check; the DB deferred trigger (T4) is the backstop.
3. Money handled exactly — use a decimal-safe representation, not JS floats, for the balance
   sum (e.g. integer paisa, or a decimal lib). Confirm approach in the plan.
4. Open ONE DB transaction. Insert the `journal_entries` header (status = 'POSTED' for now —
   the approval gate that may set PENDING_APPROVAL is T5b), then all `journal_lines`. Stamp
   `created_by = actorId` on every row. Commit.
5. On any failure (balance, DB constraint, etc.) the whole transaction rolls back — no
   partial entry. Return the created entry id on success.

> Status note: T5 posts directly to 'POSTED'. T5b will insert the gate that routes some
> entries to 'PENDING_APPROVAL' instead. Structure the code so the status decision is a
> single point T5b can extend — don't scatter it.

## Iron Laws in play

- L2 — balance enforced in code AND (already) as the DB trigger; only the engine writes lines.
- L3 — actor stamped from the real user, never null, never the service role; entry is attributable.
- L4 — every line carries a fund; entry carries an entity.

## Applicable LEARNINGS

- Supabase NUMERIC returns strings in JS — never parse money through a float. Use a
  decimal-safe path for sums and for values sent to the DB.
- The DB deferred balance trigger fires at COMMIT — so even if the in-code check were wrong,
  the DB rejects an unbalanced entry. Test both: the in-code rejection AND a committed balanced entry.
- Engine writes on service_role (BYPASSRLS); RLS does not block it. The no-authenticated-write
  policy (T4) is what stops everyone else.

## Done-criteria (tests, local Postgres + Jest)

1. A valid balanced 2-line entry posts: header + 2 lines exist, status 'POSTED',
   `created_by` = the passed actorId on entry and lines.
2. An unbalanced input is rejected by the IN-CODE check before any DB write (assert nothing
   was inserted).
3. A malformed input (negative amount; both debit and credit > 0; <2 lines; missing entity)
   is rejected by Zod.
4. Money exactness: an entry with values like 1/3-prone sums (e.g. 33.33 + 33.33 + 33.34 =
   100.00) balances correctly — no float drift.
5. Actor: a null/absent actorId is rejected (Law 3 — no unattributed write).
6. The committed entry is visible in the DB with correct fund on each line and the entity on
   the header.
7. (Integration with the DB backstop) If the in-code check is bypassed in a test by inserting
   a deliberately unbalanced entry via the engine's DB path, the DB deferred trigger still
   rejects at commit. (Confirms belt-and-suspenders.)

## On completion

End with exactly one status. Bring diff + status back to the Architect.
Next: T5b (approval gate), then T5c (reverseEntry).
