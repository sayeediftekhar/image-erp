# Task Spec — P1-T8a-mobile: Responsive layout (phone-usable admin panel)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: RESPONSIVE LAYOUT ONLY — make the existing panel usable on a phone. Same guard rails
> as the styling task: NO changes to Supabase calls, RLS, auth/session, middleware, Zod schema,
> the is-used query, or any CRUD behaviour. This reflows the EXISTING UI for small screens; it
> does not rebuild it and does not change what any screen does.

> Priority: LOOK-UP-FIRST. Sayeed uses the panel on his phone mainly to CHECK things (find an
> account, see a status, look up a user/setting), not to do heavy data entry. So mobile
> optimises for fast login + easy nav + scannable reading. Editing must still WORK on mobile
> (the modal opens and functions), but the layout is optimised for viewing, not data entry.

## Problem (one sentence)
The panel's fixed-sidebar + wide-table layout breaks on a phone (sidebar eats the screen, the
8-column table overflows); make it reflow so Sayeed can log in and look things up comfortably
on mobile, while desktop stays exactly as it is now.

## Breakpoint
Use a single clear breakpoint (Tailwind `md` ≈ 768px). At/above it: the current desktop layout,
unchanged. Below it: the mobile layout described here.

## Part 1 — Sidebar → hamburger (below md)
- Desktop (≥ md): the fixed navy sidebar stays exactly as it is (Finance / Administration groups).
- Mobile (< md): the sidebar is hidden; a **hamburger menu button** appears in the header
  (top-left or near the logo). Tapping it opens the nav as an **overlay/drawer** sliding in from
  the left (navy, same nav content + groups). Tapping a destination navigates and closes the
  drawer; tapping outside it (a backdrop) closes it. The hamburger and nav items are 44px targets.
- Keep it simple: a React state toggle for open/closed; no animation library needed (a CSS
  transform/transition is enough). No routing change — same links.

## Part 2 — Accounts table → cards (below md)
- Desktop (≥ md): the current `<table>` stays exactly as is.
- Mobile (< md): render each account as a **card** instead of a table row. Each card shows:
  - Code (mono) + Name prominent at top.
  - Type, Normal balance, Fund, Status as the same AAA badges (reused, not restyled).
  - is_control / requires_approval as small labels/icons if space allows (secondary).
  - Edit + Deactivate/Reactivate actions (44px), at the bottom or in a row.
- Search + filters stay (stack them vertically on mobile so they're tappable, full-width).
- This is a conditional render (table on md+, cards below) over the SAME data array — no data
  fetching or logic change. The card is just an alternate presentation of a row.

## Part 3 — Modal usable on mobile
- The add/edit modal must be usable on a narrow screen: near-full-width (with small margins),
  vertically scrollable if it exceeds the viewport, inputs already 44px/16px. It does NOT need
  to be beautiful for data entry (look-up-first), but it must FUNCTION — open, fill, save, close
  — on a phone. Verify the native `<dialog>` behaves on mobile (it generally does).

## Part 4 — Login + header on mobile
- Login: already a centered card — verify it renders well on a phone (it should; just confirm).
- Header: on mobile, the email/role text may need to shrink or the email truncate so the header
  doesn't overflow; keep sign-out reachable (44px). The page title can shorten on mobile.

## What must NOT change (guard rails)
- No change to any `supabase.from(...)`, RLS reliance, auth/session, middleware, Zod schema,
  the journal_lines is-used query, or insert/update/deactivate behaviour.
- No new dependencies (CSS/Tailwind transforms only; no drawer/animation library).
- No dark mode. No brand change. Desktop layout (≥ md) must look IDENTICAL to now — verify the
  desktop view is unaffected.

## Acceptance (Sayeed tests ON HIS PHONE — the real acceptance)
1. Log in on the phone → lands on the panel, login looks fine.
2. The hamburger opens the nav; tapping Accounts (or a section) works; drawer closes.
3. The Accounts list shows as readable cards — code, name, type, status all clearly scannable
   without horizontal scrolling or pinch-zoom.
4. Search/filter work on mobile (narrowing the cards).
5. Editing still works: open an account, the modal is usable, a change saves.
6. Desktop (laptop) view is UNCHANGED — the table, fixed sidebar, everything as before.
7. `grep -r "service_role" apps/web/` still nothing; app compiles.

> This responsive pattern (md breakpoint, hamburger drawer, table→cards) becomes the STANDARD
> the rest of the panel (T8b/c) and the Phase 2 manager forms inherit — record in CONTEXT. The
> Phase 2 manager forms are mobile-FIRST (clinic staff on phones); this establishes the patterns
> they'll build on.

## On completion
End with exactly one status — do NOT commit; wait for Architect review + Sayeed's PHONE test.
After this, T8a is fully complete (functional + styled + branded + responsive) → then T8b
(Parties + Settings) and T8c (Assets + Users) reuse all of it → Phase 1 done.
