# Task Spec — P1-T8e: Admin-only panel gate + non-admin landing

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: restrict the admin panel to ADMIN users at the UI/routing level, and give non-admin
> users (ENTRY / READ_ONLY / HQ_FINANCE) a simple "coming soon" landing instead of the admin
> panel. This closes Phase 1's access model. Visual/routing layer + a role check — touch no
> engine/ledger/posting/auth-mechanism logic. RLS already protects the DATA; this fixes who sees
> WHICH SCREENS.

## Why this task

A non-admin (ENTRY) user currently logs in and lands in the full admin panel — they can SEE the
chart, parties, settings, users pages. The DATA is protected by RLS (reads are scoped, writes are
admin-only — verified), so this is not a data breach, but it is wrong UX and wrong access design:
clinic managers have no business in the admin panel. The admin panel is Sayeed's tool. Non-admins
should not see it; they get a placeholder until the Phase 2 manager surface exists.

## Decisions (locked)

- The admin panel (`/accounts`, `/parties`, `/settings`, `/assets`, `/users`) is **ADMIN-only**
  for now. HQ_FINANCE access is deferred (added later if needed — not now).
- Non-admins (ENTRY / READ_ONLY / HQ_FINANCE) who log in get a **"coming soon" landing page**
  (their workspace is being built). They are recognised (shown name/role/clinic) but see no admin
  nav. This placeholder is the slot the Phase 2 manager forms will later fill.
- A read-only chart-of-accounts _reference_ for managers is a PHASE 2 item (lives in the manager
  surface, not the admin CRUD page) — note in CONTEXT, do NOT build now.

## Part 1 — Gate the admin panel to ADMIN

- In the `(admin)` route group's layout (the server component that already fetches the user +
  role for AdminShell): after resolving the user's `app_users` role, **if role !== 'ADMIN'**,
  `redirect()` them to the non-admin landing page (e.g. `/home` or `/workspace` — pick a path).
  Only ADMIN proceeds into the panel.
- This is a server-side check in the layout — runs before any admin page renders. (The existing
  middleware handles logged-in-vs-out; this adds role-gating on top, specifically for the
  `(admin)` group.)
- Result: an ENTRY user hitting `/accounts` (or any admin route) is redirected to their landing,
  never sees the admin nav or pages.

## Part 2 — The non-admin landing page (`/home` or chosen path)

- A simple, branded page (reuse the logo + navy header treatment, but NOT the admin sidebar/nav).
- Shows: the IMAGE logo + "IMAGE Management System", the signed-in user's name + role + clinic
  (if ENTRY), a friendly "Your workspace is being set up — manager features are coming soon"
  message, and a Sign-out button.
- This is where ENTRY / READ_ONLY / HQ_FINANCE land after login. It's protected (must be logged
  in) but available to any authenticated role.
- Keep it minimal and clean — it's a placeholder, not a feature. Mobile-responsive (same standard).

## Part 3 — Login redirect logic

- After a successful login, the destination depends on role: ADMIN → `/accounts` (the panel);
  non-admin → the landing page. Implement this so a manager logging in goes straight to their
  landing, and an admin to the panel.
- The root `/` redirect and the middleware should send people to the right place by role (admin →
  panel, non-admin → landing, logged-out → /login). Keep it simple and correct.

## What must NOT change

- No change to RLS policies, the engine, the ledger, the posting logic, the create-user route,
  or the auth mechanism. This is routing + a role check + one new placeholder page.
- The admin panel pages themselves are unchanged (just gated).

## Iron Laws / decisions in play

- L5 — access control: the admin panel is admin-only at the UI level now, matching the principle
  that Sayeed (admin) is the only one who manages system reference data. RLS remains the data-level
  backstop; this adds the correct UI-level gate.

## Applicable LEARNINGS

- Role is resolved from app_users via auth.uid() (the existing pattern). The gate reuses that
  resolution — no new mechanism.
- redirect() in a server component (the (admin) layout) is the clean place to gate by role.

## Acceptance (Sayeed verifies in browser)

1. As ADMIN (Sayeed): log in → land on the admin panel `/accounts` as before; everything works.
2. As ENTRY (e.g. Mothaher / abc): log in → land on the "coming soon" page, NOT the admin panel.
   Their name/role/clinic shown; no admin nav visible.
3. As ENTRY: manually navigating to `/accounts` (typing the URL) → redirected to the landing page,
   cannot reach the admin panel.
4. Sign-out works from the landing page.
5. ADMIN experience is completely unchanged.
6. App compiles; `grep -r "service_role" apps/web/src/app/(admin)` still clean.

## On completion

End with exactly one status — do NOT commit; wait for Architect review + Sayeed's browser test
(test as BOTH an admin and as an ENTRY user — the ENTRY user must NOT see the admin panel).
**After T8e, Phase 1 is COMPLETE** — backend (ledger, engine, migrations), auth, admin panel
(admin-only), and the access model are all done and deployed. Next: Phase 2 — the manager entry
forms (mobile-first), which become the real destination for non-admin users (replacing the
"coming soon" placeholder). Review the current manager Google Form first.
