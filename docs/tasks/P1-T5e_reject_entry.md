# Task Spec — P1-T5e: Rejection action (rejectEntry) + migration 0008

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: the REJECTED status + `rejectEntry()`. This is the LAST engine sub-task — after it,
> the posting engine (post / gate / reverse / approve / reject) is complete.

## Problem (one sentence)

`rejectEntry(entryId, approverId, reason?)` declines a PENDING_APPROVAL entry — marks it
REJECTED (never deletes; the proposal-and-decline is part of the record), leaves a reversal's
original POSTED and untouched, and is restricted to eligible approvers who are not the creator.

## Part 1 — migration `supabase/migrations/0008_rejected_status.sql`

Append-only; do NOT edit prior migrations.

1. **Widen the status CHECK** on `journal_entries` to allow `'REJECTED'`. The current
   constraint allows `('DRAFT','PENDING_APPROVAL','POSTED','REVERSED')`. Drop and recreate the
   CHECK to add `'REJECTED'` (a constraint change, not a column change). Confirm the exact
   constraint name from 0004 in the plan.
2. **Add `rejection_reason text`** (nullable) to `journal_entries`. Holds the optional reason
   when an entry is rejected; null otherwise.
3. **Extend T4b immutability** — `CREATE OR REPLACE` of `app.block_posted_mutation()` so
   REJECTED is also terminal/immutable: once `OLD.status = 'REJECTED'`, block UPDATE/DELETE
   (same treatment as POSTED, but with NO allowed onward transition — REJECTED is final, where
   POSTED still allows POSTED→REVERSED). Keep the POSTED logic exactly as-is. Re-confirm the
   alphabetical trigger-order note (the to_jsonb comparison still depends on immutable firing
   before touch) stays valid.
4. Regression: 0001–0007 suites still green after the constraint/column/function changes.

## Part 2 — `rejectEntry(entryId, approverId, reason?)`

1. Validate `entryId`, `approverId` (uuid); `reason` optional string if provided.
2. One transaction. `SELECT ... FOR UPDATE` the entry (same concurrency lock as promoteEntry).
3. **Guard — status must be PENDING_APPROVAL.** Else reject (can't reject a POSTED / REVERSED /
   DRAFT / already-REJECTED entry).
4. **Guard — approver eligibility:** look up `approverId` in `app_users`; role must be ADMIN or
   HQ_FINANCE (active). ENTRY / not-found / inactive → reject. (Same as promoteEntry.)
5. **Guard — separation of duties:** `approverId` ≠ entry's `created_by` → reject. (Same rule
   as approval; no self-rejection.)
6. **Flip → REJECTED:** `UPDATE ... SET status='REJECTED', rejection_reason=$reason,
updated_by=$approverId WHERE id=$entryId`. (PENDING_APPROVAL is freely mutable under T4b —
   this multi-column update is fine; the to_jsonb guard only applies to POSTED.)
7. **If the entry is a reversal** (`reverses_entry_id` set): do NOTHING to the original — it
   stays POSTED, untouched. A rejected reversal means "we decided not to reverse"; the original
   correctly remains live. (Explicitly assert this in tests.)
8. COMMIT. catch → ROLLBACK + rethrow; finally → release.

## Iron Laws in play

- L3 — rejection attributed to the approver; reason (if given) recorded; audit log captures it.
- L5 — eligibility role-based (ADMIN/HQ_FINANCE only); managers can't reject.
- Maker-checker — rejecter ≠ creator.
- Audit-first — REJECTED entries are NEVER deleted; the decline is part of the permanent record.

## Applicable LEARNINGS

- T4b: PENDING_APPROVAL is freely mutable; the flip to REJECTED with reason+updated_by is allowed.
- Once REJECTED, the entry is terminal — the extended trigger locks it (no further edits/deletes).
- Service connection: approver role looked up from app_users explicitly (no auth.uid()).
- Migrations append-only — new 0008, CREATE OR REPLACE the trigger function, never edit 0005.

## Done-criteria (migration test 0008 + engine tests)

**Migration (0008 test, psql):**

1. A `journal_entries` row can be set to status REJECTED (constraint allows it); an invalid
   status still rejected.
2. `rejection_reason` column exists, nullable.
3. A REJECTED entry cannot be UPDATEd or DELETEd (terminal immutability) — expect rejection.
4. POSTED still allows only POSTED→REVERSED; all other prior T4b behaviour intact.
5. Regression: 0001–0007 green.

**Engine (Jest):** 6. ADMIN rejects a PENDING_APPROVAL entry → status REJECTED, rejection_reason stored,
updated_by = approver. 7. Reject with no reason → status REJECTED, rejection_reason null (reason is optional). 8. ENTRY user cannot reject → rejected (not authorised). 9. Self-rejection blocked: approver == created_by → rejected (separation of duties). 10. Rejecting a non-PENDING entry (POSTED / REVERSED / DRAFT / already-REJECTED) → rejected. 11. Rejecting a REVERSAL: the reversal → REJECTED, and the ORIGINAL stays POSTED (assert the
original is untouched). 12. Full suite still green (T5 + T5b + T5c + T5d + migration suites).

## On completion

End with exactly one status. Bring diff + status back to the Architect.
This completes the posting engine (post / gate / reverse / approve / reject). Next per the
Build Plan: Phase 2 — the manager entry forms (templates that call postTransaction), built
against this engine.
