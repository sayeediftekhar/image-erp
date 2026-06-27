# P2-T4b — Expense List (read-only table) (task spec)

**Phase 2 · visibility.** A read-only table on the expenses page listing the entity's posted expense
entries, so a manager can SEE what they've entered (currently expenses vanish into the ledger with no
list). Pure read — queries EXPENSE-source journal entries, displays them. The "request to edit/delete"
action is the manager trigger for the admin correction flow (issue #5) — deferred; the list ships
view-only now, with the action wiring in when #5 is built.

**Authorities:** the existing read-only revenue day view (`/revenue/day/[date]` + ReviewStep) — mirror
its read-only pattern + house style; the expense form + post-expense route (T4a) — the entries this
lists; the entity-isolation pattern (a manager sees only their own entity's entries). On conflict, flag.

---

## 1. The problem (one sentence)
After posting an expense it disappears — there's no list — so a manager can't confirm what went
through, see status (posted vs pending approval), or later trigger a correction.

## 2. Output contract
The expenses page shows, below/alongside the entry form (or as a tab/section), a TABLE of the
manager's entity's expense entries:
- Each row = one posted expense entry (one journal_entry with source_module='EXPENSE').
- Columns: date (entry/payment date), fund (PI/RDF/Transfer — derivable from the accounts/description),
  category or description, amount, vendor, voucher#, cheque# (if any), **status** (POSTED /
  PENDING_APPROVAL — visually distinct, e.g. a badge).
- Most-recent first.
- Entity-isolated: a manager sees ONLY their own entity's expenses (server-side filter, same posture
  as everywhere else — never trust the client for entity scope).
- Pure read — displays; posts/mutates nothing.

## 3. Status display (important — the approval state must be visible)
- POSTED → a normal/green badge ("Posted").
- PENDING_APPROVAL → a distinct badge ("Pending approval" — amber) so the manager knows it's recorded
  but not yet blessed (e.g. the high-value salary + the transfer from the T4a test data).
- This visibility is the point: a manager who posted a transfer or high-value expense should SEE it's
  awaiting approval, not wonder if it went through.

## 4. The data (query shape)
- Source: journal_entries WHERE source_module='EXPENSE' AND entity_id=<manager's entity>, plus the
  joined journal_lines to derive amount + which accounts (for fund + the debit/category).
- Amount = the entry's debit total (Σdebit of the expense line) — display via the money formatter
  (/100 → Taka, the formatTaka pattern; mind the paisa-integer storage).
- Fund/category: derivable from the debit account (5xxx→PI + which category; 12xx→RDF + which stream;
  1410/2210→Transfer). Reuse the T4a routing knowledge in REVERSE (account → label) OR read from a
  stored field if the entry carries one — prefer whatever's already on the entry (ref=voucher#,
  cheque_number, description carries vendor+category). Don't re-derive fragilely from description
  string parsing if a cleaner source exists; flag if the entry lacks a clean category field and the
  only source is the description.
- voucher# = ref; cheque# = cheque_number column.

## 5. The "request to edit / delete" action (DEFERRED — view-only now)
- The list is VIEW-ONLY in this task. Do NOT build edit or delete that mutates a posted entry — a
  posted journal entry is immutable (engine sole-writer; corrections go through admin reversal).
- A "Request edit/delete" affordance is the MANAGER TRIGGER for the admin correction/reversal flow
  (GitHub issue #5 — shared maker-checker surface with revenue's "request to edit" + out-of-policy
  approval). That flow is NOT built yet.
- Option: render the button DISABLED/"coming soon", OR omit it entirely this task and add it with
  issue #5. RECOMMENDATION: omit it now (don't ship a dead button); the list is purely viewing until
  #5's correction flow exists. (Sayeed to confirm: omit vs disabled-placeholder.)

## 6. Layout
- Mirror the manager house style + the read-only revenue day view's look.
- A table that's legible on mobile (managers on phones) — consider a card-per-row on narrow widths if
  a wide table doesn't fit, same responsive instinct as the rest of the manager UI.
- The expense form and the list coexist on the page (form to enter, list to review) — decide cleanly:
  form then list below, or a tab toggle. Keep it simple; form-then-list-below is fine.

## 7. What stays out
- Any edit/delete that mutates a posted entry (issue #5 correction flow — deferred).
- The out-of-policy approval ACTION (approving a PENDING_APPROVAL entry — that's the admin/approver
  side, a separate task; this list just SHOWS the pending status).
- Filtering/search/pagination beyond most-recent-first (can be a follow-up if the list grows; not now
  unless trivial).
- Reconciliation grouping by voucher#/cheque# (Phase 4 report).

## 8. Tests / verification
- The list renders the entity's EXPENSE entries, most-recent first; entity-isolated (a JAL manager
  sees only JAL expenses — confirm a NAS expense doesn't appear).
- Amount displays correctly (paisa-integer → Taka; a 15000-paisa... mind units: confirm a Tk 5,000
  expense shows "5,000", not 500000 or 50 — the /100 formatter, the same class of bug as the revenue
  formatTaka /100 fix).
- Status badges: POSTED vs PENDING_APPROVAL visually distinct and correct (the T4a test data — the
  transfer + salary show Pending, Fresh Fusion shows Posted).
- voucher# + cheque# display where present.
- Fund/category label correct per row (PI Travel, RDF Medicine, etc.).
- Pure read — nothing posts.
- Browser (Sayeed): the three T4a test entries appear with correct amounts, vendors, and the right
  status badges; a second entity's expenses are not visible; amounts are in Taka not paisa.

## 9. Definition of done
The expenses page shows a read-only, entity-isolated, most-recent-first table of the manager's expense
entries with date, fund/category, amount (Taka), vendor, voucher#, cheque#, and a POSTED/PENDING_APPROVAL
status badge — mirroring the read-only revenue-day pattern. View-only (the request-edit/delete trigger
is deferred to issue #5). Posts nothing. Then: CONTEXT.md session note. Do NOT commit until Sayeed
browser-verifies.

---

### Plan-first
Return a plan: the query (EXPENSE entries + lines, entity-isolated, amount/fund/category/voucher#/cheque#/
status); how fund/category is derived (account→label reverse, or a cleaner stored field — flag if only
the description carries it); the table/card layout + status badges + Taka formatting (/100, the
formatTaka care); form-and-list coexistence on the page; whether the request-edit button is omitted or
disabled-placeholder; and the test list (entity isolation + Taka-not-paisa + status badges). Confirm
pure-read. Wait for approval. Do not commit.
