# IMAGE ERP — CONTEXT.md

> Cold-handoff doc. Read this + LEARNINGS.md before any session. Authority on
> financial design: `IMAGE_Finance_System_Blueprint_v3.md`. Authority on process:
> `IMAGE_ERP_Build_Guidelines.md`. Build order: `IMAGE_ERP_Build_Plan.md`.
> Phase 2 locked artifacts: `docs/tasks/Phase2_Revenue_Mapping_v2.md` (account
> mapping, canonical) · `docs/phase2/wizard_design.md` (screen flow, locked).

## Phase 0 — ratified
- **Stack:** Supabase (managed Postgres + Auth + RLS + Storage + daily backups) +
  NestJS (business logic / posting engine) + Next.js 14 (admin + entry web).
  Expo deferred to inventory floor-entry. Money = `NUMERIC(15,2)`, BDT only.
  Zod on every input. pnpm monorepo.
- **Still operational (Sayeed's to action):** confirm each clinic's connectivity
  (flaky → offline-tolerant entry becomes required).
  *(Supabase project created and deployed; git repo in place — both done.)*

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

## Phase 1 task list — ALL COMPLETE (see session logs below)
- **P1-T1 — Dimension schema + RLS — DONE (this session).**
- P1-T2 — Audit infrastructure: `audit.audit_log` + generic audit trigger; app role
  INSERT-only on audit; attach to T1 tables. (L3 full coverage.)
- P1-T3 — `settings` + seed (cap threshold, §7 asset rates, residual, fiscal year,
  high-value approval threshold = Tk 50,000 provisional).
- P1-T4 — Ledger schema (`journal_entries`, `journal_lines`) + deferred
  `Σdebit=Σcredit` trigger + the two usage-dependent triggers moved here + the
  status/entered_at/source_* columns above.
- P1-T6 — Seed chart of accounts (Blueprint §3, idempotent). **Runs before T5.**
  Sequencing: chart=T6 ships first; engine=T5 is built against the real chart.
- P1-T5 — `postTransaction()` engine (NestJS, Zod DTO, one DB txn, in-code balance
  check, per-line fund resolution, entered_by). Sole writer of journal_lines.
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

Task completed: **P1-T3 — settings + asset_classes.** Two tables with audit
  columns, require_actor, touch triggers, and RLS (same pattern as T1 reference
  tables). audit.log_change() replaced (CREATE OR REPLACE in 0003) with the
  generic id>code>key waterfall — no per-table branching; works for all 6 attached
  tables. Seeds: 3 settings + 6 asset_classes (Blueprint §7 rates, residual 0).
  Full chain: 21/21 T1 + 20/20 T2 + T3 green.
Files: supabase/migrations/0003_settings_and_asset_classes.sql ·
  supabase/tests/0003_settings_and_asset_classes_test.sql

Task completed: **P1-T4 — ledger core.** journal_entries + journal_lines with
  full audit, require_actor, touch triggers. Spine guarantee: deferrable initially
  deferred constraint trigger trg_journal_balance (SECURITY DEFINER to read all
  lines unfiltered by caller's RLS). Issue #1 closed: lock trigger on accounts
  BEFORE UPDATE (type/normal_balance); FK RESTRICT for no-hard-delete. RLS:
  ENTRY entity-scoped; no write policy for authenticated on either table (SELECT
  grant only — Law 2). Tests (37): CHECK constraints, balanced commit, unbalanced
  rejection via SET CONSTRAINTS ALL IMMEDIATE, cascade delete of DRAFT entry
  (deferred trigger sees 0=0, passes), RLS matrix 4 roles, no-write enforcement
  for ENTRY + ADMIN, issue #1 full coverage, audit + actor. Full chain:
  21/21 T1 + 20/20 T2 + 27/27 T3 + 37/37 T4 green.
  Conscious choice: orphan-header prevention delegated to engine (T5), not a
  second DB trigger — noted in migration comment.
Files: supabase/migrations/0004_ledger_core.sql ·
  supabase/tests/0004_ledger_core_test.sql

Task completed: **P1-T4b — posted-entry immutability.**
  app.block_posted_mutation() BEFORE UPDATE OR DELETE on both journal tables.
  POSTED entries/lines fully locked; sole permitted mutation is POSTED→REVERSED
  (status-only, verified via to_jsonb comparison that relies on trigger firing
  before trg_..._touch alphabetically — documented in migration comment).
  DRAFT and PENDING_APPROVAL remain freely editable. Tests (16): 3 blocked field
  edits, 1 blocked DELETE, 2 blocked line mutations, 1 allowed POSTED→REVERSED +
  assertion, 1 PENDING_APPROVAL description edit allowed, DRAFT edit + line
  fund-change + cascade delete + 2 assertions. Full chain: 21+20+27+37+16 green.
Files: supabase/migrations/0005_posted_immutability.sql ·
  supabase/tests/0005_posted_immutability_test.sql

Task completed: **P1-T6 — chart of accounts (runs before T5 engine).**
  Sequencing: original numbering had engine=T5, chart=T6, but dependency order
  is accounts→transactions. T6 ships first; T5 (engine) builds against the real
  chart. Two-step migration 0006: (1) ALTER TABLE accounts ADD COLUMN
  requires_approval BOOLEAN NOT NULL DEFAULT false; (2) 59-account idempotent
  seed (Blueprint §3, ON CONFLICT DO NOTHING, SYSTEM actor).
  normal_balance explicit per row; 1590 = ASSET/CREDIT (contra-asset). fund=NULL
  for 14 "any/—" accounts including 1190 EXIM FROZEN (cross-fund sweep; confirmed
  Sayeed 2026-06-18) and 4210 Bank Interest. requires_approval=true on exactly 9
  accounts: 1410, 1520, 2210, 3010, 3020, 3030, 3040, 3900, 4220.
  T1 test fixtures renamed 1590→Z590, 2010→Z010 to avoid conflict with 0006 seed
  (both chart codes pre-seeded before tests run). T3 test stale comment updated.
  Tests (16): count=59, 2010/1590 source verified by name, 7 spot-checks,
  requires_approval set (count + full 9-code check + false cases), idempotency.
  Full chain: 21/21 T1 + 20/20 T2 + 27/27 T3 + 37/37 T4 + 16/16 T4b + 16/16
  T6 green. Seeded 59 accounts.
Files: supabase/migrations/0006_chart_of_accounts.sql ·
  supabase/tests/0006_chart_of_accounts_test.sql ·
  supabase/tests/0001_dimension_schema_test.sql (fixtures Z010/Z590) ·
  supabase/tests/0003_settings_and_asset_classes_test.sql (stale comment)

Open questions:
  - **fiscal_year_start_month = 7 PROVISIONAL** — confirm at pilot.
  - **high_value_approval_threshold = Tk 50,000 PROVISIONAL** — confirm at pilot.
  - Confirm clinic connectivity (offline-tolerant entry may be required).
Next: P1-T6b (ledger index set, migration 0007), then P1-T5 (posting engine).

---
## Session: 2026-06-19 / 2026-06-20
Branch: main

### PHASE 1 COMPLETE — deployed to live Supabase

Tasks completed this session (P1-T7 through P1-T8e):

**P1-T7** — `fixed_assets` + `bank_feed` schema + RLS (migration 0009). Entity-scoped
  SELECT for authenticated; structure only (depreciation run is Phase 4).

**P1-T8a** — Admin panel visual polish: branded login (navy gradient, transparent PNG logo,
  "IMAGE Management System" title), AAA contrast badges (-900 text shades), 16px min text,
  44px touch targets, ring-4 focus rings, 8–12px border radius, 200–300ms transitions.
  SideNav grouped: FINANCE (Accounts, Parties, Fixed Assets) / ADMINISTRATION (Users, Settings).
  Logo: transparent PNG on white card (login); white circle container on navy sidebar.

**P1-T8a-mobile** — Single `md` breakpoint responsive layout. New `AdminShell.tsx` Client
  Component holds drawer state; `layout.tsx` stays Server Component for auth. Single responsive
  sidebar via CSS transform. Table→cards conditional render. Toolbar stacking. Modal width fix.
  Hamburger in header.

**P1-T8b** — Parties page (CRUD: table/cards/modal, kind badge, control_account dropdown
  filtered to is_control=true, mutate by UUID id) + Settings page (inline per-item edit:
  3 scalar settings with PROVISIONAL badges + 6 asset-class rates displayed as % stored as
  fraction via toFixed(4)).

**P1-T8c** — Fixed Assets page (CRUD: table/cards/modal). Migration 0010 adds
  `fixed_assets_write` policy + DML grant to authenticated so admin can write via RLS.
  `accumulated_depreciation` absent from all INSERT/UPDATE payloads (Iron Law 1 — Phase 4
  depreciation run is the sole writer). Entity dropdown + asset_class dropdown. Exact-money
  cost (NUMERIC). Capitalisation-threshold hint (non-blocking). Deactivate-not-delete.

**P1-T8d** — Users page + server-side create-user route.
  Route: `apps/web/src/app/api/admin/create-user/route.ts` — admin check first (getUser +
  app_users role), then service client (ONLY for auth.admin.createUser / deleteUser cleanup).
  app_users INSERT uses the verified admin's SSR client (RLS path) NOT the service client
  (service_role has BYPASSRLS but no table-level INSERT grant — "permission denied" is a
  GRANT error, not an RLS error). Two-step create: cleanup on failure (deleteUser) so no
  orphaned login-without-role. `SUPABASE_SERVICE_ROLE_KEY` server-only env var.
  Users page: table/cards, role badges, self-deactivation blocked, entity shown for ENTRY.
  No email column in app_users — email is set-at-creation only (lives in auth.users).

**P1-T8e** — Admin-only gate + non-admin landing.
  `(admin)/layout.tsx` gates on role: `if (appUser?.role !== 'ADMIN') redirect('/home')`.
  Server-side, runs before any page renders (no flash). Null app_users row also redirected.
  `/home` landing: branded header, name/role/clinic, "coming soon" message, sign-out.
  Login redirect: LoginForm fetches role after sign-in → admin→/accounts, non-admin→/home.
  Middleware: `user && /login → /` (root dispatches by role). Root page: role-aware redirect.

**Key learnings this session (added to LEARNINGS.md / memory):**
- BYPASSRLS ≠ table-level GRANTs. Use admin's session (RLS path) for PostgREST writes the
  admin is already permitted. Service client reserved for GoTrue Admin API only.
- service client server-side: `{ auth: { persistSession: false, autoRefreshToken: false } }`.
- auth.admin.createUser (GoTrue) and from(table).insert (PostgREST) are different endpoints
  that can fail independently — always clean up auth user if app_users insert fails.
- Gate routes by role in the Server Component layout with redirect(), not client-side.

---
## Phase 2 design brainstorm — ANCHOR: docs/reference/ Excel files
(Jalalabad real Google Form output: Revenue Entry 86 cols, Expense Entry, Stock Entry +
Master Inventory). Managers capture STATISTICAL + FINANCIAL together, per service, per day.

### Revenue form design (LOCKED):
- One day = one revenue entry, via a GUIDED WIZARD:
  Steps: date → outdoor/static (morning/evening/after-hours) → USG (by type) →
  satellite (N teams, dynamic) → delivery (clinics that do it; C-section only JAL/NAS) →
  financial wrap-up (deposits, cash-in-hand, reconciliation).
- SAVE-AS-DRAFT + return (within-day interruption).
- "Revenue Entry Management" page = list of days with status (submitted/draft/not-entered).
  Batch-friendly: managers enter 2–3 days in one sitting, often days late.
- DRAFT = staged form data, NOTHING posted. SUBMIT = posting engine fires (money→ledger)
  + statistics written (counts→operational store). Reuses DRAFT→POSTED lifecycle.
- Per-clinic adaptive (service matrix); dynamic satellite team count.

### Expense form: one submission per expense. Re-skin existing + wire to posting engine.
Current Expense Entry maps to chart: Budget Category+Sub-Category → 5000-series accounts.

### KEY ARCHITECTURE — each revenue submission drives TWO writes:
- MONEY → posting engine → journal entries (service charge→PI income, RDF sales→RDF income,
  lab→lab income, etc.) → feeds FINANCIAL reports (R&P, I&E, Balance Sheet).
- COUNTS → operational/statistics store (patients new/old, services by type, USG by type,
  by team) → feeds STATISTICAL reports + the FUSED pivot ("5 patients earned X").
  The ledger does NOT hold counts — they need their own table sharing entity+date.

### THREE report types (Phase 4, shaped by the mapping):
1. Financial (from ledger)
2. Statistical (from counts)
3. Fused pivot (counts × revenue) + executive summaries per clinic for HQ/board,
   daily→monthly cadence.

### FIRST TASK NEXT SESSION:
Column-by-column mapping of Revenue Entry → (money: which ledger account) + (count: which
statistic). Then design the operational/statistics data model, then the wizard + management page.

### Open questions for next session:
- Statistics grain: store counts per-day/service/team for free pivoting? (lean YES)
- Exact account mapping per revenue line (verify against Blueprint §3).

### Carried-forward gaps (not blocking Phase 2):
- Fixed-asset disposal (gain/loss on sale) → Phase 4; needs disposal account + flow.
- Bulk asset import → method TBD by volume when clinic Excel arrives.
- Read-only chart reference for managers → Phase 2 (their surface, not the admin CRUD page).
- /home placeholder → replaced by manager forms in Phase 2.
- HQ-Finance panel access → deferred.
- **C-section discharge fund-cash distortion (P2-T2b):** all discharge cash routes to 1010/PI
  as a deliberate simplification. The RDF income portions (4110/4130) do NOT carry matching RDF
  cash — a known PI/RDF fund-cash distortion. Resolution deferred to Phase 4/5, to be reconciled
  against real data (touches the PI/RDF bank reconciliation). Do not attempt to "fix" this by
  splitting discharge cash by fund until the bank-rec model is designed.
- **Discharge-balance cash outside the daily wizard reconciliation seam (P2-T2b):** cash received
  at discharge (and refunds out) is posted by closeDeliveryBalance, NOT by the daily revenue
  wizard. The daily cash-reconciliation identity (`opening + income − deposit − advance = closing`)
  does NOT include discharge-balance inflows or refund outflows. When the reconciliation UI is
  built in P2-T3, it must account for: (a) C-section advance-in on admission day, (b) balance
  cash-in on discharge day, and (c) refund cash-out on discharge day, as three distinct cash
  movements outside the normal income term.
- **closeDeliveryBalance entity-scoped authorisation (P2-T2b):** the close service currently
  validates only `status=OPEN`; it does NOT verify that `actorId` belongs to the same entity as
  `delivery_balance.entity_id`. When this gets a REST endpoint in P2-T3, the route handler must
  enforce entity-scoped authorisation (ENTRY role may only close balances for their own entity)
  before calling the service method.

---
## Session: 2026-06-21
Branch: main

**P2-T2 (committed cb1c59d)** — submitRevenueDay, delivery_balance table, postTransactionOnClient engine
  extension. 53/53 Jest, 12 migration suites.

**P2-T2b (committed a6be9bb, CLOSED)** — C-section holding-account correction.
  Verified via live postings: advance Dr 1010/PI + Cr 2150/PI on admission;
  discharge bill split 4030/PI + 4110/RDF + 4130/RDF with 2150 released,
  balance-by-construction confirmed. Migration 0013 applied to live Supabase.
- Migration 0013: account 2150 (Patient Advances / Deposits Received, LIABILITY/CREDIT/PI),
  setting delivery_balance_flag_days=4, delivery_balance final-bill columns (5 nullable columns
  incl. close_entry_id FK to journal_entries ON DELETE RESTRICT).
- draft-data.schema.ts: safe_delivery removed; csection simplified to {cases, balances} (no
  income fields at admission); expected_balance/expected_date optional in DeliveryBalanceEntrySchema.
- revenue.service.ts: buildIncomeInput — removed csection and safe_delivery income blocks;
  added buildCsectionAdvanceInput (Dr 1010/PI, Cr 2150/PI per day); Step 6b in submitRevenueDay;
  csectionAdvanceEntryId in SubmitResult; writeDeliveryBalances — removed safe_delivery loop;
  added closeDeliveryBalance (balance-by-construction proof in comment; idempotency on OPEN guard;
  postTransactionOnClient is sole line-writer; fund-cash distortion documented); added
  getFlaggedOpenBalances (uses revenue_date not created_at for ageing).
- Tests: T1 fixture corrected (safe_delivery removed, csection income fields removed); T1
  extended (csection advance assertions); T9-T15 new (admission/discharge/refund/idempotency/
  cross-day/ageing). 60/60 Jest, 13 migration suites.
- 0003 settings test count updated: 3→4 (delivery_balance_flag_days is the 4th setting).
- CONTEXT.md carried-forward gaps: fund-cash distortion, reconciliation seam, entity authz.
- LEARNINGS.md: fund-cash distortion documented; pg date→JS Date learning.

Next: P2-T3 — revenue wizard UI + management page (produces draft_data; surfaces
  close-balance and ageing; P2-T2b carried-forward seams get their UI integration then).

---
## Phase 2 status

**Phase 1 is complete and deployed** (migrations 0001–0010, posting engine, admin panel T8a–T8e,
live on Supabase).

**Phase 2 data-model and backend are done:**
- `docs/tasks/Phase2_Revenue_Mapping_v2.md` — canonical account + statistics mapping (locked).
  Do not derive account mappings, fund routing, or statistics grain from any other source.
- `docs/phase2/wizard_design.md` — wizard screen flow (locked).
- P2-T1: revenue_day + daily_activity + delivery_balance schema (migration 0011/0012).
- P2-T2: submitRevenueDay service, postTransactionOnClient engine extension (committed cb1c59d).
- P2-T2b: C-section holding-account (account 2150, closeDeliveryBalance, ageing query),
  migration 0013 (committed a6be9bb, live on Supabase).

**Next: P2-T3** — revenue wizard UI + management page (Next.js). Produces draft_data via the
  guided wizard; includes management list (draft/submitted/not-entered); surfaces close-balance
  workflow and ageing flag. P2-T2b carried-forward seams (reconciliation identity, entity authz
  on close endpoint) land here.
