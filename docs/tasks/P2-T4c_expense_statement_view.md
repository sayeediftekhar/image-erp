# P2-T4c — Expense Statement View (dashboard redesign) (task spec)

**Phase 2 · expense module UX.** Redesign the expenses page from form-first to a STATEMENT VIEW
(like a bank statement): summary cards + a period-filtered list of expenses, with "Post Expense" as a
button to a SEPARATE route. Reuses the list pieces already built (the entry-row card,
ExpenseListSection, the routing-label functions deriveFundLabel/deriveCategoryLabel, formatExpenseTaka)
— rehoused under cards + a period selector, NOT rebuilt. Period is URL-param-driven (server-rendered,
entity-isolated), matching the revenue calendar's ?month= pattern.

**Authorities:** the just-built expense list (page.tsx query, ExpenseListSection, routing.ts label/format
functions — REUSE); the expense form (ExpenseForm — moves to its own route, inner content unchanged);
the revenue calendar's URL-param period pattern (?month= → server re-render) — mirror it with ?from=&to=;
the entity-isolation posture (entity_id=$1 from app_users, server-side, never the client). The ledger
stores TAKA-DECIMAL in NUMERIC(15,2) — display amounts AS-IS, no ×100/÷100 (formatExpenseTaka already
correct). On conflict, flag.

---

## 1. The problem (one sentence)
The expense page opens to the entry form with the list buried below; a manager wants to LAND on an
overview — period totals + a statement-style list — and enter expenses as a deliberate action behind
a button.

## 2. Output contract — the statement view (`/expenses`)
Landing page becomes (top to bottom):
- Navy header + a **"Post Expense" button** → navigates to `/expenses/new` (the form, separate route).
- A **period selector** (custom range: from/to date pickers) driving `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
  Defaults to the CURRENT MONTH on load (first→last of this Dhaka-local month) so the page opens to a
  useful view, not blank. Changing the range updates the URL → server re-renders (like ?month=).
- **Summary cards** for the selected period (see §3).
- The **period-filtered expense list** (the existing card-per-entry list, filtered to the range, most-
  recent-first) — the "statement" body.
- Entity-isolated throughout (server-side; a manager sees only their own entity).
- Pure read; the list/cards post nothing. (Posting happens on /expenses/new.)

## 3. Summary cards (two — for now)
**Card 1 — Total expenses (period-scoped), split by fund:**
- Total spent in the selected period, broken into **PI** and **RDF** (the two fund streams clinics
  enter). Computed server-side as SUM(debit) over the period's EXPENSE entries, grouped by fund
  (fund derived from the debit account: 5xxx→PI, 12xx→RDF; Transfer 1410/2210 — see note).
- Reflects the SELECTED PERIOD (a statement's totals are for its range).
- Display amounts via formatExpenseTaka (Taka as-is).
- Note: decide how Transfer entries count — they're fund movements, not PI/RDF spending. RECOMMEND:
  show PI total, RDF total, and either exclude Transfer from the "spending" split or show it as a
  separate small line ("Transfers: Tk X"). Flag the choice; don't silently fold transfers into PI.

**Card 2 — Pending approvals (ALL currently pending, NOT period-scoped):**
- Count + total amount of entries currently in PENDING_APPROVAL for this entity — regardless of the
  selected period (an old pending item still needs approval; it must not vanish because you're
  viewing this month). This is the deliberate exception to period-scoping (confirmed).
- Surfaces what's stuck awaiting admin approval — operationally the manager's "what needs sign-off."

(Float balance card is DEFERRED — needs the not-yet-built reimbursement-cheque/float tracking.)

## 4. The period query (server-side, entity-isolated)
- The list: EXPENSE entries WHERE entity_id=$1 AND entry_date BETWEEN $from AND $to, most-recent-first
  (replaces the flat LIMIT 50). entity_id from app_users server-side — never the request/client.
- Card 1 aggregate: SUM(debit) grouped by fund over the SAME period+entity filter (a grouped query or
  derived from the fetched rows — either, but server-side).
- Card 2 aggregate: COUNT + SUM(debit) WHERE entity_id=$1 AND status='PENDING_APPROVAL' (NO period
  filter — all-time pending).
- Default range when no ?from/?to: current Dhaka-local month (first→last day).
- Validate from ≤ to; guard malformed dates (fall back to current month).

## 5. The form moves to `/expenses/new`
- ExpenseForm relocates to its own route `/expenses/new` (a new page.tsx there rendering the form).
  Inner form content, validation, posting logic UNCHANGED — only its home moves.
- On successful post → redirect back to `/expenses` (the statement view), where the new entry now
  appears in the list (if within the current period) and the cards reflect it.
- The "Post Expense" button on /expenses links here. (The old form-on-the-page layout is removed; the
  page is now the statement view.)

## 6. Reuse — do NOT rebuild
- ExpenseListSection (the card-per-entry list) — reuse; it now receives the period-filtered entries.
- routing.ts deriveFundLabel / deriveCategoryLabel / formatExpenseTaka — reuse for rows AND the card
  aggregates (same fund-derivation logic).
- StatusBadge, fmtDate — reuse.
- The entity-isolation query pattern — extend with the period filter; keep the server-side posture.

## 7. What stays out
- Float-balance card (needs reimbursement/float tracking — deferred).
- The request-edit/delete action (issue #5 correction flow — still deferred).
- Approving pending entries (the approver/admin side — separate task; this only SHOWS pending).
- Pagination/search beyond the period filter (period IS the primary filter now; add later if needed).
- Category-breakdown / trend cards (future; two cards now).
- Reconciliation by voucher#/cheque# (Phase 4).

## 8. Tests / verification
- Period filter: the list shows only entries within ?from..?to; default (no params) = current month.
  Entity-isolated (a second entity's expenses never appear).
- Card 1: PI/RDF totals = SUM(debit) by fund over the period; Taka-correct (the salary contributes
  Tk 4,58,900 not 45,89,000 — formatExpenseTaka as-is); transfers handled per the §3 decision (not
  silently in PI).
- Card 2: pending count+amount = ALL current PENDING_APPROVAL for the entity, independent of the
  period (changing the range does NOT change the pending card).
- "Post Expense" → /expenses/new renders the form; a successful post redirects to /expenses and the
  entry appears (if in range) + cards update.
- The relocated form still posts correctly (Law-6 etc. intact — it's the same form, just moved):
  a quick re-confirm an RDF post still Dr 1210, a PI post still Dr 5xxx.
- Pure read on /expenses; posting only on /expenses/new.
- Browser (Sayeed): land on /expenses → current month, cards show period PI/RDF totals + all-pending;
  set a custom range → list + spending cards update, pending card unchanged; the three test entries
  (salary Tk 4,58,900 Pending, transfer Tk 5,000 Pending, Fresh Fusion Tk 360 Posted) appear with
  correct amounts/badges; Post Expense → form on /expenses/new → submit → back to statement with the
  new row.

## 9. Definition of done
The expenses page is a statement view: a custom from/to period selector (default current month,
URL-param-driven, server-rendered), two summary cards (period-scoped PI/RDF spending total; all-current
pending-approvals count+amount), and the period-filtered expense list — with "Post Expense" linking to
the form on its own route `/expenses/new` (form unchanged, redirects back on success). Reuses the built
list/label/format pieces; entity-isolated; amounts Taka-as-is. Then: CONTEXT.md session note +
LEARNINGS note (the Taka-decimal storage clarification). Do NOT commit until Sayeed browser-verifies.

---

### Plan-first
Return a plan: the /expenses statement-view structure (header + Post button, period selector →
?from=&to=, cards, filtered list); the period query + the two card aggregates (server-side, entity-
isolated, default current month); the Transfer-in-cards decision (§3 note); moving ExpenseForm to
/expenses/new (+ redirect-back on post); reuse of ExpenseListSection/routing-labels/formatExpenseTaka;
and the test list (period filter + entity isolation + Taka-correct cards + pending-not-period-scoped +
relocated-form-still-posts). Confirm pure-read on /expenses, posting only on /expenses/new. Wait for
approval. Do not commit.
