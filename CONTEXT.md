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
- **Dev server writes to LIVE Supabase (P2-T3b):** `DATABASE_URL` in `apps/web/.env.local` now
  points at the production Supabase project (`uwtzhgmyvstvkvnuhovm`). Pre-pilot this is accepted
  to unblock development, but it violates the Guidelines' dev/prod separation. Before any real
  clinic data lands, stand up a separate Supabase dev project (or DB branch) and repoint
  `DATABASE_URL`. Note: `mark-closed` (T3a) had the same latent issue — the pool was silently
  hitting the local `erp_test` DB, so mark-closed only worked via Jest, never in the browser, until
  this session. Both routes now target the same DB as the Supabase client.
- **channels_active is authoritative for T3d posting (P2-T3c):** The wizard preserves
  sessions.* slices for deselected channels (a fat-finger toggle must not destroy entered data).
  T3d's submitRevenueDay MUST post income and write daily_activity ONLY for channels present in
  channels_active; any lingering sessions.* slice whose channel was deselected must be ignored.
  Tested: integration test confirms deselecting MORNING leaves sessions.MORNING in draft_data
  while channels_active excludes it. T3d must filter by channels_active, not by sessions keys.
- **Submitted-day correction flow (P2-T3b):** once a day is SUBMITTED its journal lines are
  immutable (`block_posted_mutation`); correcting it requires `reverseEntry` (counter-entry, both
  visible in audit) + re-entry, NOT an edit. The correction UI is NOT built. Open decision:
  admin-initiated/approved (maker-checker, per the Phase-0 reversal-approval decision) vs
  manager-self-service. Own task (Phase 2/3). T3b correctly gates this by refusing to open
  SUBMITTED days in the wizard.

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

Next: P2-T3b — wizard shell + draft lifecycle + Step 1 day-setup (channels-active), reading capabilities from clinic_service_matrix.md / capabilities.ts.

---
## Session: 2026-06-22 (session 3)
Branch: main

**P2-T3-shell (committed)** — ManagerShell wrapping (manager) routes; mobile bottom-bar
  (Home/Revenue/Expenses/Deliveries/More) + desktop DOING/VIEWING sidebar; header with
  clinic name + sign-out; real Home dashboard (missing days via classifyDays, overdue
  balances via getFlaggedOpenBalances — query-backed); six destinations with per-clinic
  adaptation; capabilities matrix (clinic_service_matrix.md) as the single source T3b reuses;
  Deliveries gated to csection clinics with server-side /deliveries redirect; Expenses/Reports/
  Bank-Rec stubs; ENTRY lands on /dashboard. 34/34 web tests green.
- ManagerShell.tsx: Client Component; mobile bottom-bar (4–5 slots + More); desktop sidebar
  (DOING: Home/Revenue/Expenses/Deliveries[JAL/NAS only] · VIEWING: Reports/Bank-Rec);
  identity + sign-out in sidebar footer (desktop) and More sheet (mobile).
- capabilities.ts: getEntityCapabilities(code) + hasDeliveries(caps) — single source;
  all five clinics have satellite (team count dynamic); Deliveries nav gated by csection flag.
- docs/reference/clinic_service_matrix.md created: canonical per-entity service matrix,
  satellite confirmed all-five-clinics.
- (manager)/layout.tsx: now fetches entity name + full_name; renders ManagerShell.
- Login dispatch + app/page.tsx: ENTRY → /dashboard (was /revenue).
- RevenueManagementClient: min-h-full (was min-h-screen); inner overflow-auto removed
  (single scroll at shell level).
- capabilities.test.ts (16 tests) + dashboard.test.ts (3 integration tests).

Next: P2-T3c — session screens (Morning/Evening/After-hours/Satellite). Gate: reconcile Phase2_Revenue_Mapping_v2.md §1/§3/§7 to the 2150 model before building.

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

- P2-T3a: Revenue Entry Management page + mark-closed zero-day (committed 38083bd).
- P2-T3-shell: ManagerShell + nav + Home dashboard + capabilities matrix (committed 2026-06-22).

- P2-T3b: Wizard shell + draft lifecycle + Step 1 day-setup (channels-active). Committed 2be0c5a.
- P2-T3c: Session screens — OutdoorSession/AfterhoursSession/UsgSection. Committed 60edc6d.
- P2-T3d: Delivery step, financial wrap-up, review/submit, submit-day route. Committed 47d6010.
- P2-T3e: Deliveries management page, DischargeForm (C-section discharge balance close + ageing),
  close-balance route. Bundled in 413dbf6 (also includes money/count validation fix).
- Validation/comma-corruption fix: money inputs strip commas, type=text everywhere, sanitize/parse
  helpers, BD phone validation. Committed 413dbf6.
- P2-T3f-A: Calendar month-view for revenue management page. Committed 8377d76.
- P2-T3f-B: Month-completeness gate + admin override. Migration 0014. Committed 9c3e63e.
- P2-T3g: Mark-closed button on day-setup + Morning/Evening "session" relabels. Committed 8a9ea60.

**Revenue-entry surface is substantially complete.**

**Next: expense form** — mapping §4 (expense accounts, fund-first), slicing TBD pending how managers
predominantly record expenses. Read Phase2_Revenue_Mapping_v2.md §4 before building.

*Design decisions:* Manager-shell task inserted before T3b — the manager surface (T3a) was built without
the persistent-shell step that the admin panel got in T8a; inserting it now keeps the plan's shell-before-
pages order. T3b uses loose partial storage for draft_data (full DraftDataSchema.parse only at submit in T3d)
so mid-wizard drafts without financial data are valid DRAFT rows.

---
## Session: 2026-06-23
Branch: main

**P2-T3c (committed 60edc6d)** — morning/evening/satellite/afterhours/USG session screens.
  OutdoorSession (channel prop → 4010 vs 4040), AfterhoursSession, UsgSection. 70/70 web + 67/67 API green.

**P2-T3d (committed 47d6010, browser-verified)** — Delivery step (NVD + C-section advance), Financial
  wrap-up with live reconciliation, Review & Submit step, and the submit-day route that calls the frozen
  engine.

Key additions:
- `reconciliation.ts` — `computeDraftFundSplit` (paisa-integer rounding matching engine's `buildIncomeInput`),
  `computeDraftIncome`, `computeAdvancesReceived`, `computeReconciliation`. 14-test suite.
- `strip-inactive.ts` — `stripInactiveChannels` applied in `handleSubmit` before final save-draft; enforces
  channels_active contract (T3c deferred this). 8-test suite.
- `DeliveryStep.tsx`, `FinancialStep.tsx`, `ReviewStep.tsx` — last three wizard steps.
- `submit-day` route — server-side auth + ENTRY entity isolation + 409 on re-submit; calls `submitRevenueDay`.
- `/revenue/day/[date]` — read-only ReviewStep for SUBMITTED days; carry-forward openingCash.
- `RevenueManagementClient` — ENTERED rows now show "View →" link to `/revenue/day/{date}`.
- `wizard/page.tsx` — SUBMITTED redirect to `/revenue/day/{date}`; openingCash carry-forward query.
- 118 web + 67 API tests green. Browser-verified end-to-end on live Supabase.

**Known limitations logged (do NOT solve in T3d):**
- **Out-of-order batch entry accuracy:** managers commonly enter days 2–3 days late in one sitting.
  The carry-forward opening_cash uses the most-recent SUBMITTED day's cash_in_hand_counted. If days are
  submitted out-of-order (e.g. day 5 before day 4), the carry-forward will be wrong for day 5 until day 4
  is submitted. No automated correction; the reconciliation delta will flag the discrepancy. Address in a
  later task that either sorts by revenue_date or shows a warning when a gap exists before this day.
- **First-day-ever opening_cash defaults to 0:** if no prior SUBMITTED day exists for this entity, the
  carry-forward query returns null and openingCash = 0. This is correct for the very first day of a new
  clinic, but managers must be aware the system cannot know the actual cash on hand before the ERP went live.
  Consider a one-time "seed opening balance" admin entry for each entity at go-live.

**Carried-forward gaps (new, from T3d):**
- **channels_active T3c contract enforced in T3d via strip-inactive.ts:** prior gap is now RESOLVED.
  `stripInactiveChannels` is called in `handleSubmit` before the final save-draft; engine reads stripped data.
- **C-section UI labels "advance / deposit held" throughout** (never "income" or "earnings") — correct per
  the 2150 holding-account model. Any future UI touching C-section must maintain this convention.

---
## Session: 2026-06-24
Branch: main

**P2-T3e (bundled in 413dbf6)** — Deliveries management page + DischargeForm (C-section discharge
  balance close) + `/api/manager/close-balance` route. Deliveries page lists open and recently-closed
  C-section balances per entity; discharge page carries expected/actual balance with real closeDeliveryBalance
  call; entity-scoped authorisation enforced in the route (carries forward the P2-T2b open issue).
  GitHub issue #6 (entity authz gap): CLOSED — route enforces ENTRY → own entity isolation before calling
  `closeDeliveryBalance`; gap is resolved.

**Validation/comma-corruption fix (413dbf6)** — Critical ledger-corruption bug: `parseFloat('15,000')`
  silently returned 15 in the money input helpers, corrupting live 2150 advances and income figures.
  Root cause: BD lakh/comma-formatted numbers (e.g. "১৫,০০০") and standard commas both appear in
  manager input; strToMoney/strToInt did not strip them. Fix: strip ALL commas unconditionally before
  parse + validate the full stripped string. Also switched all money inputs to `type=text` (type=number
  causes silent blur-reformatting corruption that unit tests never catch). Added
  `sanitizeMoney`/`sanitizeCount` (keystroke-level), `parseMoneyField`/`parseCountField` (save-time),
  `validateBdPhone`, `validateRequiredText`. Applied across 20 money + 6 count input sites in 7
  components. Browser-verified on live Supabase. 173 web + 67 API green.

**Github issues formalised this session:**
- Issue #4: **Dev/prod DB separation** — `DATABASE_URL` in `.env.local` hits the live production
  Supabase; dev writes to prod. Accepted pre-pilot; must resolve before real clinic data lands.
  Root cause of T3a mark-closed never working in the browser (pool fell back to local `erp_test`
  DB while the browser hit live Supabase → FK failures). Stand up a separate Supabase dev project
  and repoint DATABASE_URL before pilot. *(Carried forward — GitHub issue #4.)*
- Issue #5: **Submitted-day correction/reversal flow** — once a day is SUBMITTED, its journal lines
  are immutable (block_posted_mutation). Correcting requires reverseEntry (counter-entry) + re-entry,
  NOT an edit. The UI is not built. Decision deferred: admin-initiated/approved (maker-checker) vs
  manager-self-service. *(GitHub issue #5.)*
- Issue #6: CLOSED (see P2-T3e above).
- Issue #7: **PI/RDF fund-cash distortion** — C-section discharge cash routes entirely to 1010/PI;
  the RDF income portions (4110/4130) do NOT carry matching RDF cash. Structural simplification,
  deferred to Phase 4/5 bank-reconciliation model. *(GitHub issue #7.)*
- Issue #8: **Discharge-balance cash outside the daily recon seam** — cash received at discharge is
  posted by closeDeliveryBalance, NOT the daily wizard. The daily cash identity
  (opening + income − deposit − advance = closing) does NOT include discharge-balance cash-in or
  refund cash-out. Reconciliation UI must account for these separately. *(GitHub issue #8.)*

**Transactional-table TRUNCATE convention** — clean test-ledger slate for Jest integration tests:
  TRUNCATE (in FK-safe order) `journal_lines`, `journal_entries`, `daily_activity`,
  `delivery_balance`, `revenue_day` in `afterEach`/`afterAll` blocks that write to the ledger.
  These are the five tables the engine writes to. Established in T3d/T3e test suites.

**P2-T3f-A (committed 8377d76)** — replaced the scrolling day-list on `/revenue` with a
  Sunday-first month-grid calendar. Status-coloured tiles (red/amber/green/grey/neutral), tap routing
  (MISSING/DRAFT→wizard, SUBMITTED/CLOSED→day-view), prev/next month nav, jump-to-today, count header.
  Pure `buildCalendarGrid`/`tapRoute` helpers; reuses classifyDays; `DayTile` accepts `locked?` prop
  reserved for T3f-B (gate-ready). Presentation only — posts nothing. 199 web tests green;
  browser-verified.

---
## Session: 2026-06-27
Branch: main

**P2-T3f-B (committed 9c3e63e)** — month-completeness gate + admin override. ENTRY managers past
  the 10th of a month cannot enter that month until the prior month has zero MISSING days, unless an
  admin override exists or the month predates the entity's go_live_month.
- Pure `isEntryAllowed` (12 branch tests); Correction 1: prior month predating go-live must not gate
  the go-live month itself (first-month-trap guard).
- Grace window: first 10 days of the month are always open (no DB queries).
- Server-side enforcement at three write points: wizard page redirect (primary), save-draft 403,
  submit-day 403 (backstop). Locked calendar tiles are affordance only.
- go_live_month NULL = never gated (gate ships dormant; enabled per entity at go-live).
- Only new revenue ENTRY is gated — viewing, deliveries, C-section discharge stay open.
- Migration 0014: `month_gate_override` table (RLS ADMIN-write/ENTRY-read-own, audited) +
  `entities.go_live_month` (YYYY-MM CHECK). Migration verified on live Supabase.
- Admin `/gate` page: go-live-month inline editor + override grant/revoke table.
- 211 web tests green; browser-verified.
- **NOTE:** RLS session-isolation tests C3/C4 (ENTRY sees own entity only; cannot INSERT) require
  local Supabase `auth.login_as` — asserted-not-executed (Docker unavailable). Run before pilot.

**P2-T3g (committed 8a9ea60)** — mark-closed button on day-setup + session relabels.
- Always-visible "Mark day as closed (holiday / no activity)" button on Step 1 day-setup, centered,
  slate/secondary style above the navy Save & Continue.
- Adaptive confirm dialog: plain "Confirm mark [date] as closed?" when no channels selected;
  discard-warning variant ("[date] has channels selected. Mark as closed and discard them?") when
  channels are toggled on.
- Mark-closed goes via `markClosedDay()`/`submitRevenueDay()` service path directly — NOT the gated
  submit-day HTTP route. This is intentional: resolving a day is what the gate wants, so mark-closed
  is correctly never gate-blocked (no deadlock).
- "Morning clinic"/"Evening clinic" → "Morning session"/"Evening session" — display-only; channel
  keys MORNING/EVENING, routing, and posting unchanged.
- Removed the stale "use Mark as closed from the day list" amber hint.
- 211 web tests green; browser-verified.

## Go-live strategy (LOCKED DECISION)

Pilot starts CLEAN and FORWARD-ONLY. No historical daily-entry backfill.

- **Opening balances:** one opening-balance journal entry per entity at go-live (Phase 6 task).
  This seeds the ledger position without requiring back-entered daily revenue/expense history.
- **Bulk upload:** deferred — there is no operational requirement to import past data before pilot.
- **`go_live_month`:** a per-entity field on `entities` (NULL = gate dormant). Set it to the first
  month the ERP goes live for each entity. Months before `go_live_month` are never gated
  (the gate only applies from go-live month onwards).
- **Revenue history:** managers will enter going-forward from go-live date; prior months remain
  unrecorded in the ERP (known gap, acceptable for pilot).

## Current state (as of 2026-06-27)

Revenue-entry surface is substantially complete:
- Full wizard flow (day-setup → sessions → delivery → financial → review/submit)
- Calendar management page with status colours and gate-locked tiles
- Month-completeness gate with admin override and go-live month configuration
- C-section advance/discharge close flow and ageing dashboard
- Mark-closed for holidays/zero-activity days
- Input validation hardened against comma-corruption

**NEXT: expense form** — read Phase2_Revenue_Mapping_v2.md §4 (expense mapping, fund-first) before
building. Slicing TBD pending how managers predominantly record expenses (per-item vs lump-sum).
