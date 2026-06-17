# IMAGE ERP — CONTEXT.md

> Cold-handoff doc. Read this + LEARNINGS.md before any session. Authority on
> financial design: `IMAGE_Finance_System_Blueprint_v3.md`. Authority on process:
> `IMAGE_ERP_Build_Guidelines.md`. Build order: `IMAGE_ERP_Build_Plan.md`.

## Phase 0 — ratified
- **Stack:** Supabase (managed Postgres + Auth + RLS + Storage + daily backups) +
  NestJS (business logic / posting engine) + Next.js 14 (admin + entry web).
  Expo deferred to inventory floor-entry. Money = `NUMERIC(15,2)`, BDT only.
  Zod on every input. pnpm monorepo.
- **Still operational (Sayeed's to action):** create Supabase project; git repo with
  separate dev/prod; confirm each clinic's connectivity (flaky → offline-tolerant
  entry becomes required).

## Design decisions locked (this session)
- **Module integration = control-account pattern.** Each future module (payroll,
  inventory, procurement) owns its granular detail and posts ONE summarised entry
  to a GL control account via `postTransaction()`. Employee/TDS/PF detail never
  enters `journal_lines`. Ledger = source of truth for position/TB; each sub-module
  = source of truth for its own detail, reconciled to its control account.
- **Future analysis dimensions** (dept / cost-centre / grant) arrive as nullable
  columns or a `line_dimensions` side table — NEVER as chart-code explosions.
  Not building a dimension framework now (over-build); door kept open at ~0 cost.
- **RDF markup = observed margin only.** No pricing rule, no markup field, no markup
  entry page. Computed Phase-4 report: Σ RDF sales − RDF COGS, per clinic +
  consolidated. Doubles as a margin tripwire (drift = under-recorded sales or bad count).
- **COGS seam (Phase 8):** inventory closing count feeds ONE month-end posting
  template (`Dr 5210/20/30 COGS / Cr 1210/20/30 RDF Stock`, Opening+Purch−Closing).
  Until then the count is keyed manually. Accounting side never changes.
- **Falsification controls (layered, by phase):** immutable reversing-entry
  corrections (no UPDATE/DELETE of posted lines); `entered_at` server timestamp ≠
  transaction `date` (lateness/backdating detector); period locking
  (open→pending-close→locked); maker-checker approval on high-value entries + all
  reversals + month-end COGS; deterministic exception-report views; RLS-enforced
  segregation of duties. Principle: software makes falsification *detectable &
  costly*, never impossible — HQ must still read the flags.
- **Monthly reporting:** system-generated **PDF close pack** (consolidated-first,
  then per-entity) = formal record; **Excel workbook export** (consolidated tab +
  per-clinic tabs) = analysis only. Excel is never the system of record.
- **Late entries:** soft-close window absorbs minor lateness; past cutoff, late
  items post to current open month with true date (gap flags them) OR route to
  Sayeed as pending-approval against the closing period. Per-entity close checklist
  gates the lock.
- **Report access:** per-clinic PDF pack downloadable by that clinic's manager +
  all higher roles; **consolidated view = Admin / HQ-Finance / Auditor ONLY**;
  final pack generates post-lock; optional live-draft view for a manager's own
  current month.
- **High-value approval threshold:** seeded PROVISIONALLY at **Tk 50,000**, marked
  "confirm at pilot". It's a setting; nothing is hard-coded to the number.

## Schema shape recorded for later tasks (so the ledger is born ready)
- `journal_entries` (T4) will carry: `entered_at timestamptz not null default now()`,
  `source_module text not null default 'MANUAL'`, `source_id uuid null`,
  `status` enum(DRAFT / PENDING_APPROVAL / POSTED / REVERSED).
- Posting engine (T5) interface commitments: `reverseEntry(entryId)` (whole-entry
  reversal, never line-picking) + approval gate (threshold / reversal / COGS →
  PENDING_APPROVAL). Period-lock check lives in the engine (single writer).

## Ordering correction made this session
Original P1-T1 listed the account *type/normal_balance* "lock once used" trigger and
the "no hard-delete if used" trigger. Both need `journal_lines` to know if a record
is used — that table is T4. **Both triggers moved to T4.** T1 ships the full
structure, `active` deactivate flag, CHECK constraints, RLS, audit columns, and the
FK-RESTRICT slice of "deactivate, don't delete".

## Phase 1 task list
- **P1-T1 — Dimension schema + RLS — DONE (this session).**
- P1-T2 — Audit infrastructure: `audit.audit_log` + generic audit trigger; app role
  INSERT-only on audit; attach to T1 tables. (L3 full coverage.)
- P1-T3 — `settings` + seed (cap threshold, §7 asset rates, residual, fiscal year,
  high-value approval threshold = Tk 50,000 provisional).
- P1-T4 — Ledger schema (`journal_entries`, `journal_lines`) + deferred
  `Σdebit=Σcredit` trigger + the two usage-dependent triggers moved here + the
  status/entered_at/source_* columns above.
- P1-T5 — `postTransaction()` engine (NestJS, Zod DTO, one DB txn, in-code balance
  check, per-line fund resolution, entered_by). Sole writer of journal_lines.
- P1-T6 — Seed chart of accounts (Blueprint §3, idempotent).
- P1-T7 — `fixed_assets` + `bank_feed` schema + RLS (structure only).
- P1-T8 — Admin panel (Next.js CRUD: accounts/parties/settings; deactivate; lock
  type/normal_balance once used).

## Phase 4/5/6 inventory captured
Phase 4: Receipts & Payments, Income & Expenditure (RDF markup), Balance Sheet,
consolidation (TB Care ring-fenced), Trial Balance, GL, fund-movement, AP ageing,
receivables, inter-clinic (nets to zero), investments register, fixed-asset
register, depreciation schedule, accruals listing, policies note, exception-report
views, PDF pack + Excel export. Phase 5: bank reconciliation statements. Phase 6:
per-entity close checklist; **post-pilot "Auditor Pack" single export bundle**
(don't front-load PDF formatting before numbers are validated).

---
## Session: 2026-06-17
Branch: main

Task completed: **P1-T1 — dimension schema (entities, accounts, parties) +
  app_users role mapping + RLS + audit columns + constraints.** Tested on real
  Postgres 16: 21/21 checks pass (constraints, L3 actor guard, contra-asset
  modelling, full RLS matrix per role, FK-restrict, touch trigger).

Task completed: **P1-T2 — audit infrastructure.** audit.audit_log table +
  generic AFTER INSERT/UPDATE/DELETE SECURITY DEFINER trigger (audit.log_change())
  attached to entities, accounts, parties, app_users. SECURITY DEFINER + zero
  direct grant confirmed as deliberate stronger-than-§2 choice: authenticated
  cannot forge an audit row at all. Actor never null (SYSTEM uuid sentinel).
  Text-PK branch for accounts; jsonb-based field access so trigger is safe on
  tables without created_by/updated_by (e.g. app_users). RLS: SELECT for ADMIN
  / HQ_FINANCE / READ_ONLY; ENTRY blocked. Combined test run: 21/21 T1 green +
  20/20 T2 green on Postgres 16.14 (homebrew). Three shim gaps fixed during
  build (see LEARNINGS.md).
Files: supabase/migrations/0002_audit_log.sql ·
  supabase/tests/0002_audit_log_test.sql ·
  supabase/tests/00_local_supabase_shim.sql (3 fixes) ·
  supabase/migrations/0001_dimension_schema.sql (app schema grant added)

Next task: **P1-T3 — settings table + seed** (cap threshold, §7 asset rates,
  residual, fiscal year, high-value approval threshold = Tk 50,000 provisional).
Open questions: confirm Tk 50,000 threshold at pilot; confirm clinic connectivity.
Blockers: none.
