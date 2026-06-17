# Task Spec — P1-T4: Ledger core (journal_entries + journal_lines)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope discipline: T4 is **structure + database-level guarantees only**. The posting
> engine, the draft→posted promotion, reverseEntry(), and the approval gate are **T5
> (NestJS), not here**. T4 lays the columns and constraints those will use. Do NOT
> build any TypeScript/engine logic in this task. Posted-immutability is **T4b**, the
> next task — do NOT build it here either; T4 only leaves the hook (status column).

## Problem (one sentence)

The ledger — `journal_entries` (header) + `journal_lines` (postings) — must exist with
its spine guarantee (`Σ debit = Σ credit` per entry) enforced in the database, scoped so
a clinic manager can read only their own entity, and structurally impossible for a
manager to write directly (Law 2: only the engine writes lines).

## Output contract

One migration `supabase/migrations/0004_ledger_core.sql`:

### Table 1 — `public.journal_entries` (header; one transaction)

- `id uuid primary key default gen_random_uuid()`
- `entity_id uuid not null references public.entities(id) on delete restrict`
- `entry_date date not null` — the transaction date the user STATES (economic date)
- `description text not null`
- `ref text` — optional human reference (cheque no, voucher)
- `status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','POSTED','REVERSED'))`
- `reverses_entry_id uuid references public.journal_entries(id) on delete restrict`
  — set on a reversing entry, points at the entry it cancels (null otherwise)
- `source_module text not null default 'MANUAL'` — provenance: MANUAL / PAYROLL / INVENTORY / …
- `source_id uuid` — originating doc id in that module (null for MANUAL)
- `entered_at timestamptz not null default now()` — SERVER clock; ≠ entry_date. Backdating/lateness detector.
- audit columns: `created_by uuid not null default auth.uid()`, `created_at`, `updated_by`, `updated_at`
- `require_actor` BEFORE INSERT, `touch_updated` BEFORE UPDATE, audit trigger AFTER I/U/D.

### Table 2 — `public.journal_lines` (the postings)

- `id uuid primary key default gen_random_uuid()`
- `entry_id uuid not null references public.journal_entries(id) on delete cascade`
  — lines belong to their entry; deleting a (draft) entry removes its lines.
- `account_code text not null references public.accounts(code) on delete restrict`
  — RESTRICT = the "no hard-delete if used" guarantee for accounts (issue #1, free via FK).
- `party_id uuid references public.parties(id) on delete restrict`
  — nullable; RESTRICT = same no-delete-if-used guarantee for parties.
- `fund fund not null` — fund resolved at posting time; on the LINE (inter-fund entries span funds)
- `debit  numeric(15,2) not null default 0 check (debit  >= 0)`
- `credit numeric(15,2) not null default 0 check (credit >= 0)`
- `check (not (debit > 0 and credit > 0))` — a line is debit XOR credit, never both
- `check (debit > 0 or credit > 0)` — a line is never zero on both sides
- audit columns + `require_actor` + `touch_updated` + audit trigger (same as every table).

### The spine guarantee — Σ debit = Σ credit (Law 2, DB backstop)

- A **DEFERRABLE INITIALLY DEFERRED constraint trigger** on `journal_lines`, firing at
  COMMIT (not per-row — an entry is transiently unbalanced mid-insert). At commit, for each
  affected `entry_id`, assert `sum(debit) = sum(credit)`; raise and roll back the whole
  transaction if not. Name it clearly (e.g. `trg_journal_balance`).
- Rationale for deferred: the engine inserts header + N lines in one transaction; the check
  must see the complete set, so it runs once at commit.
- **Orphan-header note:** a constraint trigger on `journal_lines` does not fire for a header
  with zero lines. We rely on the single-writer engine (T5) to never create orphans rather
  than adding a second trigger now (over-build). Note this in CONTEXT as a conscious choice.

### Issue #1 trigger — lock type/normal_balance once an account is used

- `BEFORE UPDATE on public.accounts`: if `type` or `normal_balance` is changing AND
  `exists (select 1 from public.journal_lines where account_code = OLD.code)`, raise.
  (Unused accounts stay freely editable; used accounts lock — Blueprint §8.)
- The "no hard-delete if used" half needs NO trigger — it's the `journal_lines.account_code`
  / `party_id` FK `ON DELETE RESTRICT` above. Note this in the migration comment.
- This closes GitHub issue #1.

### RLS (Law 5) — the first real entity-scoped matrix

- Enable RLS on both tables.
- **READ:**
    - `journal_entries`: ENTRY sees only `entity_id = app.current_entity()`; ADMIN / HQ_FINANCE
      / READ_ONLY see all rows.
    - `journal_lines`: scope by the parent entry's entity — `exists (select 1 from
journal_entries je where je.id = entry_id and (app.current_role() in
('ADMIN','HQ_FINANCE','READ_ONLY') or je.entity_id = app.current_entity()))`.
- **WRITE:** **NO write policy for `authenticated` on either table.** The posting engine
  runs server-side on the `service_role` (BYPASSRLS) and is the sole writer (Law 2). A
  clinic manager's JWT therefore has no row-level INSERT/UPDATE/DELETE path to the ledger
  by any route, including the Supabase REST API. This is the DB-level enforcement of
  "only the engine writes lines."
- Grants: `grant select on public.journal_entries, public.journal_lines to authenticated;`
  Do NOT grant insert/update/delete to authenticated. (service_role already bypasses.)

## Relevant files (read before write)

- `supabase/migrations/0001_dimension_schema.sql` (entities, accounts, parties; require_actor, touch, RLS helpers app.current_entity/current_role/is_admin)
- `supabase/migrations/0002_audit_log.sql` + `0003_*.sql` (audit trigger to attach)
- `supabase/tests/00_local_supabase_shim.sql`, `CONTEXT.md`, `LEARNINGS.md`

## Iron Laws in play

- L2 — Σdebit=Σcredit enforced as a DB constraint; only the engine writes lines (no authenticated write path).
- L3 — every line/entry attributed (require_actor) and audited (audit trigger).
- L4 — every line carries a fund; every entry an entity. (TB Care exclusion is report-time, not here.)
- L5 — RLS entity-scoping tested per role.

## Applicable LEARNINGS

- RLS blocks UPDATE/DELETE silently (0 rows) — but here authenticated has NO write grant,
  so direct writes fail at the PRIVILEGE layer (permission denied) → use expect_fail, like
  the audit-log append-only tests, NOT the silent-0-row pattern.
- Deferred constraint triggers fire at COMMIT — a test that wants to see the rejection must
  wrap the unbalanced insert in its own transaction/savepoint and force the commit/release.
- Seeds/tests with no auth.uid() need the SYSTEM uuid; engine writes carry the real user.
- gen_random_uuid is available (pgcrypto/pg16 core).

## Done-criteria (the test `0004_ledger_core_test.sql` must prove)

1. A balanced entry (header + ≥2 lines, Σdr=Σcr) inserted in one txn COMMITS. (Insert as
   owner/service_role to stand in for the engine; the engine itself is T5.)
2. An UNBALANCED entry (Σdr≠Σcr) is REJECTED at commit by the deferred trigger.
3. A line with both debit>0 and credit>0 is rejected; a line with both = 0 is rejected;
   a negative debit/credit is rejected.
4. RLS reads: a JAL ENTRY user sees only JAL entries/lines; an NAS entry is invisible to them;
   ADMIN/HQ_FINANCE/READ_ONLY see all.
5. WRITE denial: an `authenticated` ENTRY user attempting INSERT into journal_entries or
   journal_lines fails with permission denied (no write grant) — expect_fail.
6. Issue #1: changing `type`/`normal_balance` on an account that HAS journal_lines is
   rejected; changing them on an UNUSED account is allowed; deleting a used account is
   rejected by FK restrict; deleting an unused account is allowed.
7. Audit + attribution: inserting an entry/line writes an audit row (record_id = the uuid id)
   and require_actor rejects a null-actor write.
8. Full regression: 0001 (21) + 0002 (20) + 0003 (27) still green.

## On completion

End with exactly one status: DONE (evidence) / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT.
Bring the diff + status back to the Architect for Iron-Law review.
Then T4b: posted-entry immutability trigger (block UPDATE/DELETE when status='POSTED';
corrections must be reversing entries) — separate task, separate spec.
