# Task Spec — P1-T5c: reverseEntry (whole-entry reversal)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: `reverseEntry()` only. It CREATES a pending reversing entry; it does NOT flip the
> original to REVERSED. The flip happens at APPROVAL time (the approval action is the NEXT
> task, T5d — not this one). Building the flip here would create a half-reversed-books window
> if the reversal is later rejected. Do NOT build the approval action in T5c.

## Problem (one sentence)

`reverseEntry(entryId, actorId)` creates a new entry that cancels a POSTED entry — every
debit/credit swapped, linked back via `reverses_entry_id`, routed to PENDING_APPROVAL — so
corrections are reversals, never silent edits (the reversal-not-overwrite rule).

## Behaviour

`reverseEntry(entryId, actorId)`:

1. Validate `actorId` (uuid) and `entryId` (uuid).
2. Read the original entry + its lines (on the service pool).
3. **Guard — only POSTED entries reverse.** If the original's status is DRAFT,
   PENDING_APPROVAL, or REVERSED → reject with a clear error. (DRAFT: just edit it.
   PENDING_APPROVAL: not yet real. REVERSED: already reversed — and prevents double-reversal.)
4. **Guard — not already reversed.** If another entry already has
   `reverses_entry_id = entryId`, reject (no two reversals of the same entry).
5. Build the reversing entry: same `entity_id`, same `entry_date` (or today's date — decide
   in the plan and note it), description like "Reversal of <original ref/id>", same lines but
   **debit and credit swapped** on each (original Dr 5000/Cr 0 → Dr 0/Cr 5000), same
   `account_code`, `fund`, `party_id`.
6. Post it through `postTransaction` with **`isReversal = true`** and the original's id as
   **`reverses_entry_id`** — both engine-set, never user input. The gate (T5b) routes it to
   PENDING_APPROVAL because isReversal is true.
7. **The original stays POSTED.** Do NOT flip it. The flip to REVERSED happens when the
   reversal is approved (T5d).
8. One DB transaction for the read-and-create. Actor stamped as `created_by`. Return the
   reversing entry's id.

## How reverses_entry_id gets set (engine-internal channel)

`postTransaction` does not take `reverses_entry_id` from user input (Zod schema unchanged).
Extend the SAME internal channel `isReversal` uses — e.g. an internal options object or
parameter `{ isReversal, reversesEntryId }` that only `reverseEntry` (and future engine code)
sets. The HTTP controller never exposes it. Decide the cleanest signature in the plan;
keep the public Zod input untouched.

## Iron Laws in play

- L2 — corrections are reversing entries through the engine, never edits to posted lines.
- L3 — the reversal is attributed to the actor who triggered it.
- L4 — swapped lines keep the same fund + entity; the reversal nets the original to zero.

## Applicable LEARNINGS

- T4b makes POSTED entries immutable; the flip POSTED→REVERSED is the one allowed mutation
  and belongs to the APPROVAL step, not here.
- Integer-paisa money; the swapped entry is balanced by construction (swapping Dr/Cr of a
  balanced entry yields a balanced entry) — but the in-code balance check + DB trigger still run.
- Reversal routes to PENDING_APPROVAL via the T5b gate (isReversal=true short-circuits).

## Done-criteria (tests, local Postgres + Jest — extend the spec)

1. Reversing a POSTED entry creates a new entry: status PENDING_APPROVAL,
   `reverses_entry_id` = original id, every line's debit/credit swapped, same accounts/funds/
   entity, balanced.
2. The original entry is STILL POSTED after reverseEntry (not flipped).
3. Reversing a DRAFT / PENDING_APPROVAL / REVERSED entry → rejected with a clear error.
4. Double-reversal blocked: calling reverseEntry twice on the same entry → the second rejects.
5. Actor stamped: the reversing entry's `created_by` = the actorId passed to reverseEntry.
6. The swapped entry balances (Σdebit = Σcredit) — confirmed by it posting without the
   balance error.
7. Full suite still green (T5 core + T5b gate unaffected).

## On completion

End with exactly one status. Bring diff + status back to the Architect.
Next: T5d — the approval action (promote PENDING_APPROVAL → POSTED; for a reversal, also flip
the original to REVERSED, in one transaction). This is what the gate + reverseEntry have been
building toward.
