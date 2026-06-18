# Task Spec — P1-T5d: Approval action (promoteEntry)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: `promoteEntry()` only — approving a PENDING_APPROVAL entry. NOT in this task:
> rejection (T5e). Do NOT build a REJECTED path or status here.

## Problem (one sentence)

`promoteEntry(entryId, approverId)` approves a PENDING_APPROVAL entry — flips it to POSTED,
and if it is a reversal, flips the original it cancels to REVERSED in the same transaction —
enforcing that only eligible approvers (ADMIN/HQ_FINANCE, never the creator, never a manager)
can approve.

## Behaviour

`promoteEntry(entryId, approverId)`:

1. Validate `entryId` and `approverId` (uuid).
2. One transaction (`BEGIN`). All guards + flips inside it.
3. **Read the entry.** If not found → reject.
4. **Guard — status must be PENDING_APPROVAL.** If POSTED / DRAFT / REVERSED → reject with a
   clear error (only pending entries can be approved).
5. **Guard — approver eligibility (role lookup).** The engine runs on the service connection
   (no auth.uid()), so look up `approverId` in `public.app_users`:
    - role must be `ADMIN` or `HQ_FINANCE`. If `ENTRY` (or not found / inactive) → reject
      ("not authorised to approve").
6. **Guard — separation of duties.** `approverId` must NOT equal the entry's `created_by`
   → reject ("cannot approve your own entry"). Maker ≠ checker.
7. **Flip the entry → POSTED.** (status-only update; the T4b immutability trigger must allow
   PENDING_APPROVAL→POSTED — confirm it does; T4b only locks POSTED, so PENDING_APPROVAL is
   freely mutable. Verify in the plan.)
8. **If the entry has `reverses_entry_id` set** (it is a reversal): also flip the ORIGINAL
   entry (the one `reverses_entry_id` points at) from POSTED → REVERSED — **in this same
   transaction.** The cancel (original→REVERSED) and the correction (reversal→POSTED) commit
   together, so the books are never half-reversed. If the original is not POSTED at this
   point (already reversed by something else) → reject the whole thing (rollback).
9. The approver is recorded: the status-flip UPDATE stamps `updated_by` via the touch trigger
   (= approverId), and the audit log captures the change with the actor. (No new
   approved_by/approved_at column in this task — updated_by + audit trail suffice.)
10. COMMIT. Return success (e.g. the entry id, now POSTED).
11. catch → ROLLBACK + rethrow; finally → release.

## Notes

- The approver id reaches the engine the same way actorId does (passed in; the future HTTP
  controller supplies the authenticated user). The role check is an EXPLICIT query against
  `app_users` — NOT RLS (the service connection has no logged-in user).
- "Add an approver" = give that person the HQ_FINANCE (or ADMIN) role in app_users. No
  separate approver mechanism — role IS the eligibility.
- The original-flip uses the same POSTED→REVERSED transition T4b permits (status-only).

## Iron Laws in play

- L3 — the approval is attributed to the approver; audit log records the status change.
- L5 — eligibility is role-based (ADMIN/HQ_FINANCE only); managers (ENTRY) cannot approve.
- Maker-checker (separation of duties) — approver ≠ creator, enforced.

## Applicable LEARNINGS

- Service connection has no auth.uid() → role must be looked up explicitly from app_users by
  the passed approverId.
- T4b: only POSTED is immutable; PENDING_APPROVAL→POSTED and POSTED→REVERSED are both allowed
  status transitions. The coupled reversal flip relies on POSTED→REVERSED being permitted.
- Couple the two flips in one transaction — never leave a reversal POSTED with its original
  still POSTED (double-counted), nor an original REVERSED with its reversal still pending.

## Done-criteria (tests, local Postgres + Jest — extend the spec)

1. ADMIN approves a normal PENDING_APPROVAL (high-value) entry → it becomes POSTED.
2. HQ_FINANCE can also approve → POSTED. (Role eligibility covers both.)
3. An ENTRY user (manager) attempting to approve → rejected ("not authorised").
4. Self-approval blocked: approver == created_by → rejected, even if approver is ADMIN.
5. Approving a reversal: the reversal → POSTED AND the original it points at → REVERSED, both
   after one promoteEntry call. Assert both statuses in the DB.
6. Coupling/atomicity: if the original is not POSTED when approving its reversal (simulate),
   the whole promote rolls back — reversal stays PENDING_APPROVAL, nothing half-applied.
7. Approving a non-PENDING entry (already POSTED, or DRAFT, or REVERSED) → rejected.
8. updated_by on the approved entry = approverId (attribution of the approval).
9. Full suite still green (T5 + T5b + T5c unaffected).

## On completion

End with exactly one status. Bring diff + status back to the Architect.
Next: T5e — rejection (mark PENDING_APPROVAL → REJECTED, never delete; a rejected reversal
leaves its original POSTED/untouched). Adds the REJECTED status value.
