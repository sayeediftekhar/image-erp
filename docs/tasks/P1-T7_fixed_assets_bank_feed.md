# Task Spec — P1-T7: fixed_assets + bank_feed schema (structure only)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: schema + RLS + audit triggers ONLY. NO posting logic, NO depreciation run, NO
> reconciliation, NO SMS import. The depreciation run (Phase 4) populates accumulated_depr;
> the bank-feed import (Phase 5) writes bank_feed. T7 builds the tables those will use.

## Problem (one sentence)

Two structural tables: `fixed_assets` (the asset register — a subsidiary ledger under GL
control 1590) and `bank_feed` (the independent bank-balance record the manager sees and
Phase 5 reconciles against), both entity-scoped, audited, RLS-protected.

## Output contract — migration `supabase/migrations/0009_fixed_assets_bank_feed.sql`

### Table 1 — `public.fixed_assets` (asset register; subsidiary to GL 1590)

- `id uuid primary key default gen_random_uuid()`
- `entity_id uuid not null references public.entities(id) on delete restrict`
- `name text not null`
- `asset_class text not null references public.asset_classes(code) on delete restrict`
  — FK to the T3 table; the depreciation RATE lives with the class, not here.
- `purchase_date date not null`
- `cost numeric(15,2) not null check (cost >= 0)`
- `accumulated_depreciation numeric(15,2) not null default 0 check (accumulated_depreciation >= 0)`
  — populated by the Phase 4 deterministic depreciation run (class rate × cost,
  straight-line). NEVER hand-entered as a figure. The asset register's sum of this
  column reconciles to GL control account 1590. Comment this clearly.
- `active boolean not null default true` — deactivate (disposed/written-off), never hard-delete
- audit columns: `created_by uuid not null default auth.uid()`, `created_at`, `updated_by`, `updated_at`
- `require_actor` BEFORE INSERT, `touch_updated` BEFORE UPDATE, audit trigger AFTER I/U/D.
- Index: `(entity_id)`, `(asset_class)`.

### Table 2 — `public.bank_feed` (independent bank-balance record)

- `id uuid primary key default gen_random_uuid()`
- `entity_id uuid not null references public.entities(id) on delete restrict`
  — whose clinic's account this balance belongs to.
- `account_code text not null references public.accounts(code) on delete restrict`
  — the GL bank account this statement balance is for (e.g. 1110 SJIB Current).
- `statement_date date not null`
- `statement_balance numeric(15,2) not null` — what the bank says (independent of the ledger)
- `source_ref text` — the originating SMS/row id from the pipeline
- `source_module text not null default 'SMS_FEED'`
- audit columns + `require_actor` + `touch_updated` + audit trigger.
- **Dedup guard:** `unique (account_code, source_ref)` (where source_ref is not null) — the
  same SMS message can't import twice. Use a partial unique index if source_ref is nullable.
- Index: `(entity_id)`, `(account_code, statement_date)`.

### RLS (Law 5) — entity-scoped, like the ledger

- Enable RLS on both.
- **fixed_assets READ:** ENTRY sees only `entity_id = app.current_entity()`; ADMIN/HQ_FINANCE/
  READ_ONLY see all.
- **bank_feed READ:** SAME entity-scoping — a manager SEES their own clinic's bank feed (so
  they don't issue cheques blind against the book/bank balance). ADMIN/HQ_FINANCE/READ_ONLY
  see all. (Managers seeing the balance is fine; RECONCILIATION — signing off book=bank — is
  HQ/auditor only, and that's a Phase 5 action, not a table permission here.)
- **WRITE (both):** NO write policy for `authenticated`. fixed_assets is written by the admin/
  service path (asset entry + the depreciation run); bank_feed by the service import path
  (Phase 5). Grant `select` to authenticated; do NOT grant insert/update/delete. (service_role
  bypasses RLS — same pattern as journal tables.)
    - NOTE: this means fixed_assets entry (Sayeed entering the clinic count) goes through a
      service/admin path, consistent with "managers don't write these directly." Confirm in plan.

## Iron Laws in play

- L1 — accumulated_depreciation is computed by the deterministic Phase 4 run, never estimated.
- L3 — both tables attributed (require_actor) + audited.
- L4 — every row carries an entity.
- L5 — RLS entity-scoped, tested per role; no authenticated write path.

## Applicable LEARNINGS

- Audit trigger resolves record_id generically (id/code/key) — fixed_assets & bank_feed use id.
- RLS blocks UPDATE/DELETE silently for the grant-present case; but here authenticated has NO
  write grant → direct writes fail at the privilege layer (expect_fail), like the ledger tables.
- normal money rule: NUMERIC(15,2), never float.
- Seeds/tests with no auth.uid() need the SYSTEM uuid.

## Done-criteria (test `0009_fixed_assets_bank_feed_test.sql`)

1. fixed_assets: insert a valid asset (FK to a real asset_class, e.g. MEDICAL) succeeds;
   accumulated_depreciation defaults 0; cost < 0 rejected; bad asset_class FK rejected.
2. bank_feed: insert a valid feed row succeeds; the dedup guard rejects a second row with the
   same (account_code, source_ref); bad account_code/entity FK rejected.
3. RLS reads: a JAL ENTRY user sees only JAL fixed_assets and JAL bank_feed; an NAS row is
   invisible; ADMIN/HQ_FINANCE/READ_ONLY see all. (Both tables, per role.)
4. WRITE denial: an authenticated ENTRY user INSERT into either table → permission denied.
5. Audit + require_actor: insert writes an audit row (record_id = uuid id); null-actor rejected.
6. Full regression: 0001–0008 suites still green.

## On completion

End with exactly one status — do NOT commit; wait for Architect review.
Next: T8 — the admin panel (first frontend: CRUD for accounts/parties/settings/asset entry;
deactivate-not-delete; lock type/normal_balance once used).
