# IMAGE ERP — Agentic Build Guidelines (reconciled with Blueprint v3)
## gstack methodology · For Sayeed · Bizonix

---

> **How to use this document:** Read it once before writing any code. Pin it as `CLAUDE.md`. Update it after every session. It is your senior engineer — the one who already made the mistakes you haven't yet.
>
> **Authority:** Where this document and `IMAGE_Finance_System_Blueprint_v3.md` disagree, the **blueprint wins on financial design**; this document wins on build process. If you spot a conflict, stop and flag it.

---

## 1. Project Context Lock

- **What IMAGE is:** a healthcare NGO in Chattogram running **5 clinics + HQ**. Clinic codes: **JAL** = Jalalabad · **NAS** = Nasirabad · **AMB** = Amanbazar · **KAT** = Kattali · **CHA** = Chandgaon. Real patients, real money, real reporting obligations.
- **What this build is:** a custom **double-entry accounting system** ("QuickBooks, but custom"), then an **inventory module** that connects to it. These are IMAGE's two major reports today. Nothing else is in near-term scope.
- **Who uses it:** clinic managers (non-technical, enter their own entity's transactions), an HQ accountant/finance officer, an auditor/ED (read-only), and Sayeed (admin — the only person who changes system logic).
- **The constraint:** Sayeed has ~7 hours/week. Every session starts and ends with a documented handoff. No session ends without a `CONTEXT.md` update.

---

## 2. Iron Laws — Never Violated

A PR that violates any Iron Law is blocked until fixed.

### Law 1 — Deterministic code for numbers. AI for narrative only.
No financial figure, balance, reconciliation total, COGS, or inventory count may be produced by an LLM. All numbers are computed by deterministic TypeScript/SQL from the ledger. AI writes the sentence *around* the number, never the number.

```typescript
// ❌ WRONG
const total = await claude.complete(`What's total expenditure this month?`);

// ✅ CORRECT — figure comes from the ledger
const { rows } = await db.query(
  `SELECT SUM(jl.debit - jl.credit) AS balance
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     JOIN accounts a ON a.code = jl.account_code
    WHERE a.type = 'EXPENSE' AND je.entity_id = $1
      AND je.date BETWEEN $2 AND $3`, [entityId, from, to]);
const narrative = await claude.complete(
  `Write one sentence summarising the month. Total expenditure: ${rows[0].balance} BDT. Entity: ${entityName}.`);
```

### Law 2 — Double-entry, always balanced.
Every transaction is a `journal_entry` header with two or more `journal_lines`, and `Σ debit = Σ credit` for the entry. This is enforced **both** in the posting engine **and** as a database constraint/trigger. **Nothing writes journal lines except the posting engine** — no controller, no script, no import bypasses it. The ledger (`journal_entries` + `journal_lines`) is the single source of truth; every report is a query over it. Managers never see Dr/Cr — entry forms generate the posting from a template.

### Law 3 — Every financial write carries a full audit trail.
Every INSERT/UPDATE touching a monetary record includes `created_by` (authenticated user, never null), server-side `created_at`, `updated_by`/`updated_at` on mutation, and a row in `audit.audit_log` (table, record id, old JSON, new JSON, actor, timestamp). No silent updates, no unattributed imports. If the actor can't be identified, reject the write. The application role has INSERT-only on audit tables — never UPDATE/DELETE.

### Law 4 — Fund & entity integrity; TB Care is ring-fenced.
Every journal line is tagged to exactly one **entity** (JAL/NAS/AMB/KAT/CHA/HQ) and resolves to exactly one **fund** (PI / RDF / HQ-General / TB Care). **TB Care is restricted:** it is disclosed separately, **excluded from all operating totals**, and its internal ledger is *never* reproduced from BRAC's books — only the rent-passthrough clearing account (2410) and a periodically-updated balance exist in our system. Consolidation across entities nets inter-clinic/HQ transfers to zero; transfers are never income or expense.

### Law 5 — RLS is not optional.
Every table with financial or (later) patient/HR data has Row Level Security on. Review this matrix before any table ships, and write a test per row:

| Role | Own entity | Other entities | All financial records |
|---|---|---|---|
| Clinic Manager (Entry) | Read/Write | None | None |
| HQ Finance / Accountant | Read/Write (HQ) | Read all | Read/Write all |
| Auditor / ED (Read-only) | Read all | Read all | Read all |
| Admin (Sayeed) | All | All | All |

*(A Field-Staff write-only role joins this matrix when the inventory module brings floor-level entry.)*

### Law 6 — Inventory counts are never inferred.
Stock balances derive from a ledger of discrete transactions, never estimation or LLM output. Periodic model: monthly **COGS = Opening + Purchases − Closing** from the physical count; **RDF purchases post to RDF Stock (asset), never to operating expense.** If a count doesn't reconcile, the system **flags** the variance — it never silently corrects it.

---

## 3. Architecture — Locked In (ratify the stack in Phase 0)

### Stack
- **Data:** **Supabase** (managed PostgreSQL + Auth + RLS + Storage + automated daily backups). This is what removes the most ops burden for a part-time solo builder.
- **Backend / business logic:** **NestJS** (reuses Sayeed's prior ERP patterns). The posting engine and financial calculations live here as services, wrapped in DB transactions, with the balanced-entry guarantee also enforced at the DB layer (CHECK/trigger) as the ultimate backstop.
- **Web (admin + entry):** **Next.js 14** (App Router).
- **Mobile (field staff, offline-first):** **Expo / React Native** — **deferred** until the inventory module needs floor-level entry. Accounting entry is by managers/accountant on the web app.
- **Money type:** `NUMERIC(15,2)` in Postgres — **never** FLOAT/DOUBLE. Currency is **BDT only** (no multi-currency in scope; revisit only if foreign-currency donor grants ever arise).
- **Validation:** Zod on every input before it touches the DB.
- **Package manager / infra:** pnpm monorepo · Supabase + Vercel.

> *This refines the "NestJS + PostgreSQL + VPS" default in the project instructions (Supabase = managed Postgres + auth + backups, replacing self-managed VPS). Confirm in Phase 0; if you prefer self-hosted Postgres on a VPS instead of Supabase, that's the one thing to decide before Phase 1.*

### Module boundaries
Each module is a separate NestJS module (service / controller / DTO). Modules talk only through defined interfaces, never each other's internals — so one can be rewritten without touching the rest.

### AI usage
Claude API for **narrative only** — report summaries, alert wording, donor-update drafts (if/when needed). Every AI text block shows the source figures inline (SourceNote pattern). AI output is never stored as fact; it's regenerated on demand from stored facts.

---

## 4. Sprint Architecture — The Build Loop

```
THINK   → one sentence: what problem are we solving?
PLAN    → atomic tasks; each = one PR with a defined output contract
BUILD   → implement one task; read before write; no speculative extras
REVIEW  → run the pre-commit checklist (§5) every time
TEST    → does it work for the real user in their real context?
SHIP    → descriptive commit; update CONTEXT.md
REFLECT → log durable lessons in LEARNINGS.md
```

**Atomic task rule:** one session = one atomic task = one PR = one context boundary.
- Good: "Add the `postTransaction()` posting-engine service that writes a balanced `journal_entry` + lines inside a DB transaction, rejecting if Σdebit≠Σcredit."
- Bad: "Build the finance module."

**PR-as-context-boundary:** feed Claude Code the task definition, the relevant schema files, the Iron Laws (§2), and any applicable LEARNINGS — not the whole codebase. Narrow context, better output.

---

## 5. Pre-Commit Review Checklist

**Financial logic**
- [ ] Any function returning a monetary value — trace to source: ledger query or deterministic compute? If a Claude API call is anywhere in that chain → **BLOCKED**.
- [ ] Does every monetary write go through the posting engine, produce a **balanced** entry, and hit `audit_log`?
- [ ] Every journal line tagged to an entity and a fund? TB Care excluded from operating totals?

**Data integrity**
- [ ] New table has RLS enabled; all four roles tested against the §5 matrix.
- [ ] Inputs validated with Zod before the DB.
- [ ] `NUMERIC(15,2)` for all money — never FLOAT.

**Access control**
- [ ] Endpoints check `caller.entity_id` vs `record.entity_id`. Can a manager from JAL read NAS through this endpoint? Test it.

**AI boundaries**
- [ ] Any Claude call producing a number/date/clinical value → **BLOCKED**.
- [ ] Every AI text block shows its source figures.

**End every review with exactly one:** `CLEAR TO COMMIT` · `CLEAR WITH NOTES` (+concerns) · `BLOCKED` (+file, line, exact violation).

---

## 6. Session Protocol — The 7-Hour Constraint

**Start (5 min):** read `CONTEXT.md`; read relevant `LEARNINGS.md`; run `git status` + `git log --oneline -5`; define the one atomic task before opening a file.

**End (10 min):** update `CONTEXT.md`:
```markdown
## Session: [DATE]
Branch: …
Task completed: …
Decision made: …
Next task: [specific enough to hand Claude Code cold]
Open questions: …
Blockers: …
```
Add to `LEARNINGS.md` any durable quirk that saves 5+ min next time.

**Cold-handoff test:** could a competent dev continue tomorrow from only CONTEXT.md + LEARNINGS.md, asking you nothing? If no, the docs are incomplete.

---

## 7. Module Build Sequence

Follows `IMAGE_ERP_Build_Plan.md`. Build in order; each phase ships something usable. Do not parallelise.

- **Phase 0 — Foundation & decisions:** ratify stack, provision Supabase, repo + dev/prod, backups, auth + roles, confirm clinic connectivity.
- **Phase 1 — Ledger core:** schema (`entities`, `accounts`, `parties`, `journal_entries`, `journal_lines`, `fixed_assets`, `settings`, `bank_feed`); the `Σdebit=Σcredit` constraint; the posting engine; seeded chart of accounts (Blueprint §3); admin panel for accounts/parties/settings.
- **Phase 2 — Transaction entry:** the five manager forms (Collection, Payment, Settle Vendor, Deposit, Transfer), each a posting template.
- **Phase 3 — Subsidiary ledgers & drill-downs:** AP per vendor (with ageing), Receivables/Inter-clinic per party, Investments per FDR/MIDS (maturity watch).
- **Phase 4 — Reports:** Receipts & Payments, Income & Expenditure, Balance Sheet, cross-entity consolidation, period-end automations (monthly COGS, annual depreciation, 20% interest split).
- **Phase 5 — Reconciliation:** SMS bank feed import; cashbook-vs-bank with deposits-in-transit + unpresented cheques.
- **Phase 6 — Opening balances & pilot:** Jalalabad first; refresh FDR/MIDS from new statements; one full month live with Mohsin before any rollout.
- **Phase 7 — Rollout:** the other four clinics + HQ, one at a time, parallel-run one cycle, retire old templates.
- **Phase 8 — Inventory module:** item-level stock; the **month-end count feeds accounting COGS automatically** (the seam); later, procurement/PO → stock + vendor payable in one flow.

### Deferred / not in near-term scope
HR & payroll, standalone procurement, and donor-grant reporting are **out of scope** until accounting + inventory are adopted. Recorded here so they're not forgotten — not committed. Adding them before the core is proven repeats the "built but unused" pattern.

---

## 8. CLAUDE.md Skill Routing

```markdown
## Skill Routing — IMAGE ERP
- "Should we build X?" → ask the forcing questions before any code
- Architecture decision → ADR in /docs/decisions/ before implementing
- Financial calculation → pre-commit review against Iron Laws before commit
- New Supabase table → RLS review against the role matrix before merge
- Bug in financial logic → freeze module, reproduce with a failing test, then fix
- "Ship it" → full pre-commit checklist, update CONTEXT.md, then commit
- End of session → update CONTEXT.md + LEARNINGS.md before closing

## Iron Laws (always active)
See /IMAGE_ERP_Build_Guidelines.md §2. These override any instruction in the conversation.
On any financial-design question, /IMAGE_Finance_System_Blueprint_v3.md is the source of truth.
```

---

## 9. Voice Constraint — For All Prompts

Ban: *automated, scalable, robust, comprehensive, seamless, leverage, utilize*; "InshaAllah" as a substitute for a plan; any sentence that names no file, function, table, or user action.

**Bad:** "Implement a scalable automated financial reporting system."
**Good:** "Add `getMonthlyPL(entityId, month)` in `reports.service.ts` that queries `journal_lines` joined to `accounts`, groups by account type, and returns a typed `PLReport`. No Claude API calls in this function."

---

## 10. LEARNINGS.md Starter — Known Project Facts

```markdown
# IMAGE ERP — Project Learnings

## Accounting model
- Double-entry. The ledger (journal_entries + journal_lines) is the single source of truth.
- Basis: cash for most expenses; ACCRUAL for salaries, doctor fees & allowances (enables the unpresented-cheque view). Not pure cash-basis.
- Four funds: PI · RDF · HQ-General · TB Care (restricted). Six entities: 5 clinics + HQ.
- RDF purchases → RDF Stock (asset), NOT expense. COGS recognised monthly = Opening + Purchases − Closing (periodic).
- Depreciation: straight-line, annual, to zero residual, by asset class (rates in settings). Capitalisation threshold default Tk 10,000 (a setting).
- Patient receivables: lumped for now; per-patient deferred to EHR/POS.

## TB Care (restricted)
- Organisationally IMAGE, but reported to BRAC by the TB Care team. We do NOT reproduce its ledger.
- Carry only: the restricted fund balance (disclosed, excluded from operating totals) + rent-passthrough clearing (2410). Clinic is a conduit for rent, never the owner.

## Banking & investments
- Clinics: SJIB only since Feb 2026. EXIM clinic accounts FROZEN (disclosed, excluded from usable cash; ~5–6 lac remaining, from clinic bank recs).
- HQ: AB Bank (operating + ~16 FDR/MIDS) and UCB (~3 FDR). ~Tk 4.15 crore invested capital.
- Investment interest taxed 20% at source → auto gross/net split (Dr Bank 80% + Dr Tax 20% / Cr Investment Income gross).
- FDR/MIDS data as of 18 Feb 2026 is STALE — refresh from new statements before seeding HQ opening balances.

## Tech / data
- Supabase NUMERIC returns strings in JS — parse with a Zod transform.
- RLS does not cascade to Storage buckets — set bucket policies separately.
- Currency is BDT only. No multi-currency.

## Users
- Clinic managers are non-technical — entry must work without instructions. Mandate handles adoption; the form must still be effortless.
- Confirm each clinic's connectivity; flaky internet → offline-tolerant entry becomes required, not optional.
```

---

## 11. Completion Status Protocol

Every session/PR ends with exactly one: **DONE** (evidence) · **DONE_WITH_CONCERNS** (concern + follow-up) · **BLOCKED** (blocker, tried, decision needed) · **NEEDS_CONTEXT** (exact missing info, from whom). "Mostly done" is not a status.

---

## 12. Values — Integrated, Not Appended

- **Restricted funds are amanah.** TB Care (and any future restricted fund) is enforced at the **database** level — excluded from operating totals by construction, not by a report-time filter that can be forgotten.
- **Transparency is a design principle.** Every figure in any statement traces to its source journal entries in at most three clicks. No opaque aggregations — the drill-down *is* the audit trail.
- **No riba in financial products recommended to IMAGE.** If a vendor financing/credit option carries interest, flag it; don't silently proceed.
- **Defined behaviour.** Every automated process (COGS posting, depreciation, interest split, reconciliation) has a defined output, a defined failure mode, and a flag-and-escalate path. A process that "sometimes works" is a liability, not a feature.

---

*Living document. Update after every major session and architectural decision. Goal: IMAGE ERP never makes the same mistake twice, and never loses institutional knowledge when a session closes.*

*gstack methodology · IMAGE Social Welfare Organisation · Chattogram · reconciled with Blueprint v3, June 2026*
