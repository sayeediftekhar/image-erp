# Task Spec — P1-T2: Audit log + generic audit trigger

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

## Problem (one sentence)
Every write to a financial/reference table must leave an immutable audit row
(Iron Law 3); T1 added `created_by`/`updated_by` columns but nothing yet records
the change history itself.

## Output contract
- New migration `supabase/migrations/0002_audit_log.sql`:
  - `create schema audit;`
  - `audit.audit_log`: `id bigint generated always as identity primary key`,
    `table_name text not null`, `record_id text not null` (TEXT, because
    `accounts` PK is the text `code` while others are uuid — normalise to text),
    `op text not null check (op in ('INSERT','UPDATE','DELETE'))`,
    `old_json jsonb`, `new_json jsonb`, `actor uuid`, `at timestamptz not null default now()`.
  - `audit.log_change()` trigger function, **SECURITY DEFINER**, AFTER
    INSERT/UPDATE/DELETE FOR EACH ROW: writes one row capturing `TG_TABLE_NAME`,
    the row's id/code as text, `TG_OP`, `to_jsonb(old)`/`to_jsonb(new)`, and
    `actor = coalesce(auth.uid(), new.updated_by, new.created_by, old.updated_by)`.
  - Attach the trigger to `entities`, `accounts`, `parties`, `app_users`.
  - **Append-only:** `revoke insert, update, delete, truncate on all tables in
    schema audit from authenticated, anon;` — the SECURITY DEFINER trigger is the
    ONLY writer; the app role has no direct access at all.
  - RLS on `audit.audit_log`: enable; SELECT for ADMIN / HQ_FINANCE / READ_ONLY
    only (oversight roles). ENTRY managers cannot read the audit log. No
    UPDATE/DELETE policy for anyone.
- New test `supabase/tests/0002_audit_log_test.sql`.

## Design note to confirm in the plan (Architect flagged)
The Build Guidelines §2 say "the application role has INSERT-only on audit tables."
This spec goes **stronger**: SECURITY DEFINER trigger + zero direct grant, so the
app role can't even forge an audit row. Confirm this stronger choice in the plan
before building — it's a deliberate deviation from the literal wording, same intent
(append-only, never UPDATE/DELETE), tighter guarantee.

## Relevant files (read before write)
- `supabase/migrations/0001_dimension_schema.sql` (tables to attach to; PK shapes)
- `supabase/tests/00_local_supabase_shim.sql` (auth.uid(), login_as for tests)
- `CONTEXT.md`, `LEARNINGS.md`

## Iron Laws in play
- L3 — audit trail: every monetary/reference write leaves an attributed row.
- L5 — RLS on the new `audit.audit_log` table; test per role.

## Applicable LEARNINGS
- RLS blocks UPDATE/DELETE *silently* (0 rows, no error) — test write-blocks by
  asserting the row was NOT changed, not by expecting an exception.
- Migration-time seeds have no `auth.uid()`; actor may be the SYSTEM uuid or null
  for those — handle, don't crash.
- Policy-called helpers are SECURITY DEFINER to avoid RLS recursion.

## Done-criteria (the test must prove)
1. INSERT / UPDATE / DELETE on each of the four tables writes exactly one
   `audit.audit_log` row with the correct `op`, `old_json`/`new_json`, and `actor`.
2. `authenticated` cannot UPDATE or DELETE an existing audit row, and cannot INSERT
   one directly (append-only, trigger-only).
3. ENTRY cannot SELECT `audit.audit_log`; ADMIN and READ_ONLY can.
4. CONTEXT.md `## Session` block + LEARNINGS.md updated in the SAME commit.
5. All prior P1-T1 tests still pass.

## On completion
End with exactly one status: DONE (evidence) / DONE_WITH_CONCERNS / BLOCKED /
NEEDS_CONTEXT. Bring the diff + status back to the Architect for Iron-Law review.
