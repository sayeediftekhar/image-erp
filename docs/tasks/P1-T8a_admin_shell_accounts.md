# Task Spec — P1-T8a: Admin panel — app shell + branding + Accounts page

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: the reusable branded SHELL (sidebar, logo, nav, header) + the ACCOUNTS page only
> (table + add/edit modal + deactivate + locked-field handling). The other four sections
> (Parties, Settings, Assets, Users) are LATER tasks (T8b+) that reuse this shell. Build the
> pattern once, here, well. NOT in this task: those four sections; any transaction/posting UI.

> Architecture (locked): reference-data CRUD goes Next.js → Supabase DIRECTLY, with RLS
> enforcing admin-only writes (the app_users is_admin() policies from T1). NO NestJS endpoints
> for this — Supabase + RLS IS the backend for reference data. (The engine/apps-api is only
> for transactions, not this task.) The web app uses the ANON key + the user's session; RLS
> does the rest. Service_role key NEVER in apps/web (unchanged from auth task).

## Problem (one sentence)

Build the branded admin shell every panel page will sit in, and the first real CRUD surface —
the Accounts page — so Sayeed can view, add, edit, and deactivate chart-of-accounts entries
through a UI instead of SQL, with the type/normal_balance "lock once used" rule surfaced.

## Part 1 — Branding assets

- Logo files go in `apps/web/public/`: `image-logo.png` (transparent) and `image-logo.jpeg`
  (white bg). Sayeed places them there.
- **Verify the PNG is genuinely transparent** (not a black/white filled background). If
  transparent → use it on the navy sidebar. If NOT transparent → fall back to the JPEG on a
  white circular container in the sidebar. Use the JPEG on white/light headers + login
  regardless. State which path you took in the status report.
- **Brand colors (define as CSS variables / Tailwind theme tokens, single source):**
    - `--navy-deep` for large surfaces (sidebar, headers) — a DEEP, slightly desaturated navy,
      easier on the eyes than the raw logo color. Start at approx `#0F0A52` and leave it as ONE
      editable token so Sayeed can nudge the exact shade after seeing it in the browser.
    - `--navy-vivid` = `#13007D` (the true logo color) for small accents only (primary buttons,
      active nav highlight, avatar).
    - Neutrals: slate grays for text/borders; white working surfaces.
    - Semantic (map to entry/account states): green = active/posted, amber = pending, red =
      rejected/error, gray = inactive. Use for status badges consistently.
    - Font: Inter (or system sans fallback). Clean, readable.

## Part 2 — The app shell (reusable layout)

A layout that wraps all panel pages:

- **Left sidebar** (navy-deep): logo badge + "IMAGE / ERP · Finance" wordmark at top; nav items
  Accounts · Parties · Settings · Assets · Users (only Accounts is built now — others can be
  visible-but-inactive links or stubs). Active item highlighted.
- **Header** (white): current page title left; signed-in email + role + sign-out right (reuse
  the working auth session + role lookup from the auth task).
- **Main content area** (white/neutral): where each page renders.
- Protected by the existing middleware (must be logged in). Keep using `getUser()` server-side.
- The shell is a Next.js layout (e.g. an authenticated route group) so every future page
  inherits it without re-implementing.

## Part 3 — The Accounts page

Reads/writes `public.accounts` directly via Supabase (RLS: all authenticated can read; only
ADMIN can write — already enforced from T1).

**Table view:**

- Columns: code, name, type, normal_balance, fund, control (is_control), requires_approval,
  status (active/inactive). (Keep it readable — some columns can be compact/icon.)
- **Search** (by code or name) and **filter** (by type; by active/inactive) — client-side over
  the fetched rows (≈59 rows, no pagination needed).
- Inactive accounts visually de-emphasised (e.g. gray badge), not hidden.
- Grouping by type is a deferred nice-to-have — flat list now.

**Add / edit (MODAL):**

- A modal/side panel over the table. Fields: code, name, type, normal_balance, fund (nullable),
  is_control, requires_approval, active.
- **Zod validation** before write (code length 3–12, name non-empty, valid enum values).
- **Lock rule (surface the T4 DB guarantee in the UI):** if an account is in use (has
  journal_lines), `type` and `normal_balance` are shown DISABLED with a clear note ("Locked —
  account has transactions; type and normal balance can't change"). The DB enforces this
  regardless (T4 trigger); the UI surfaces WHY rather than letting a save fail mysteriously.
    - To know "is it used": query whether any journal_lines reference this code. (A count is fine.)
- On save: insert or update via Supabase; show the new/updated row in the table; handle the
  error case (e.g. RLS rejection, duplicate code) with a readable message.

**Deactivate (not delete):**

- A "deactivate" action sets `active = false` (never hard-delete). A deactivated account can be
  reactivated. No delete button at all (deletion is blocked by FK anyway once used; and the
  policy is deactivate-don't-delete).

## Iron Laws / decisions in play

- L5 — RLS is the enforcement: a non-admin hitting this page can READ but writes fail at the DB.
  (Sayeed is ADMIN; but the UI shouldn't _offer_ writes it can't make — fine to assume admin
  for now since only admins reach the panel, but the write path must rely on RLS, not UI trust.)
- Deactivate-don't-delete (Blueprint §8).
- Lock type/normal_balance once used (Blueprint §8 / T4 trigger) — surfaced in UI.
- Service_role key never in apps/web.

## Acceptance (two halves)

**Functional (Sayeed verifies in browser):**

1. Log in → land on the panel → Accounts page shows the seeded chart (~59 rows).
2. Add a new account → it appears in the table; re-opening shows it persisted (DB write worked).
3. Edit an unused account's name → saves. Try to edit type on a USED account → fields disabled
   with the lock note.
4. Deactivate an account → status flips to inactive; reactivate → back to active.
5. Search and filter narrow the list correctly.
6. Sign-out still works; page is unreachable when logged out.

**Visual (Sayeed judges):** 7. The navy/logo/branding looks professional (board-presentable). The exact `--navy-deep`
shade is tunable — Sayeed nudges the token after seeing it.

> This is a UI task — automated tests cover what they can (Zod validation, the is-used check
> logic), but acceptance is Sayeed using it in the browser. Note this in the status.

## On completion

End with exactly one status — do NOT commit; wait for Architect review + Sayeed's browser test.
Next: T8b — Parties + Settings pages (reuse shell); then T8c — Assets + Users pages. After T8,
Phase 1 is complete → Phase 2 (manager entry forms).
