# Task Spec — P1-T8a-style: Branded login + design polish (visual layer only)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: VISUAL LAYER ONLY. Build the branded login page, and apply a defined design standard
> across the shell + Accounts page. Do NOT touch: the Supabase calls, the RLS reliance, the
> auth/session logic, the CRUD data flow, the Zod schemas, the is-used lock logic. The
> functional T8a (already tested and working) stays exactly as-is — this re-skins it, it does
> not rebuild it. If a change would alter behaviour, it's out of scope.

## Why this standard (provenance)

These standards are drawn from established UI/UX guidance for FINANCE + HEALTHCARE admin tools
(the closest product archetypes to IMAGE ERP: "Invoice & Billing Tool", "Banking/Traditional
Finance", "Medical Clinic"). The consistent recommendation for this archetype is: \*\*Minimalism

- Accessible & Ethical style, professional navy + functional accent colors, restraint over
  flash.\*\* IMAGE's existing navy/logo already matches this; this task adds precision, not a new
  direction.

## The app-wide UI standard (apply here, becomes the standing standard for Phase 2 too)

Define these as tokens / shared styles so every page (now and future) inherits them:

**Brand (unchanged — anchor everything to these):**

- `--navy-deep` (large surfaces: sidebar, login panel) — current `#0F0A52`, keep tunable.
- `--navy-vivid` `#13007D` (small accents: primary buttons, active nav, focus).
- The IMAGE logo (JPEG on white; PNG on navy if transparent).

**Accessibility (WCAG AAA target — this is the key upgrade):**

- **Text contrast ≥ 7:1** against its background. THIS FIXES the faint type/balance badges —
  status/type badges must use a dark-enough text on light-enough fill to hit 7:1 (e.g. the
  badge text uses the 800/900 shade of its color family, not a mid tone).
- **Minimum font size 16px** for body/data text (never below).
- **Touch targets ≥ 44×44px** for all interactive elements (buttons, row actions, nav items,
  modal controls) — matters for managers on tablets/phones in Phase 2.
- **Visible focus rings 3–4px** on every focusable element (keyboard nav).
- **Semantic HTML** (proper `<button>`, `<label>`, `<table>` semantics; alt text on the logo).

**Soft-UI polish tokens (professional warmth without flash):**

- Border radius **8–12px** on cards/inputs/buttons (consistent).
- **Soft shadows** — softer than flat-design hard edges, NOT neumorphic; subtle elevation on
  cards/modals only.
- Transitions **200–300ms** on hover/focus/state changes (smooth, not instant, not slow).
- Generous whitespace; clear type hierarchy.

**Status color semantics (consistent app-wide, AAA contrast):**

- green = active / posted, amber = pending, red = rejected / overdue / error, gray = inactive /
  draft. Each badge: tint fill + same-family dark text (≥7:1).

**Anti-patterns to AVOID (finance/trust archetype):**

- No gradients-as-decoration, no AI-purple/pink, no neon, no dark-crypto aesthetic, no playful
  effects. Restraint = trust. (Light mode, navy, clean.)

## Part 1 — The branded login page (`/login`)

Currently bare. Rebuild the _presentation_ (the auth logic stays):

- Centered card on a clean background (subtle navy or neutral; not a flat white void).
- **The IMAGE logo** prominently (the JPEG on white works here), with "IMAGE ERP" / a short
  descriptor ("Finance System" or similar) beneath.
- Email + password fields: 16px text, 44px+ height, clear labels, visible focus rings, radius
  8–12px, soft border.
- Primary "Sign in" button in `--navy-vivid`, 44px+, hover/focus states (200–300ms).
- The existing generic error message ("Invalid email or password"), styled clearly (red, AAA).
- No sign-up link (unchanged). The redirect on success stays `/accounts` (already fixed).
- Looks board-presentable and consistent with the panel.

## Part 2 — Polish the shell + Accounts (re-skin, don't rebuild)

- **Shell:** apply radius/shadow/transition tokens, 44px nav targets, focus rings, AAA contrast
  on the navy sidebar text (white on `--navy-deep` already passes; verify). Logo treatment as is.
- **Accounts table:** RAISE BADGE CONTRAST to AAA (the faint ASSET/DEBIT badges → darker text on
  their tint). 16px min text. Row action buttons (Edit/Deactivate) to 44px targets with focus
  rings. Tighten the header/search area spacing for a cleaner top. Hover state on rows (subtle).
- **Add/edit modal:** inputs 44px+/16px/radius/focus-ring; buttons 44px+; soft shadow on the
  modal; the locked-field note styled clearly. (Logic unchanged — same Zod, same is-used check.)
- Keep everything light-mode, navy-anchored.

## What must NOT change (guard rails)

- No change to any `supabase.from(...)` call, RLS reliance, auth/session, middleware, Zod
  schema, the journal_lines is-used query, or insert/update/deactivate behaviour.
- No new dependencies beyond what styling needs (Tailwind is already in). No component library
  swap. No dark mode.
- If the skill (if ever installed) or any guidance suggests changing the BRAND (different
  palette/font), IGNORE — IMAGE's navy + Inter + logo are fixed.

## Acceptance (Sayeed judges in browser)

1. Login page: logo present, branded card, looks professional; login still works → /accounts.
2. Accounts badges are clearly readable now (contrast visibly improved).
3. Buttons/inputs/nav feel appropriately sized (not cramped); focus rings visible on keyboard tab.
4. Overall: consistent, board-presentable, still obviously the IMAGE navy brand.
5. All functional T8a behaviour still works exactly as before (add/edit/deactivate/search/filter).
6. `grep -r "service_role" apps/web/` still returns nothing; app still compiles.

> Note for CONTEXT: this app-wide UI standard (AAA contrast 7:1, 16px min, 44px targets, 3–4px
> focus, 8–12px radius, 200–300ms, soft shadows, navy+status-color semantics, finance/health
> restraint) becomes the STANDING standard for Phase 2 manager forms. Record it. Also record:
> consider Lexend font for the manager-facing forms specifically (readability-optimised) — a
> Phase 2 decision, not now; admin panel stays Inter.

## On completion

End with exactly one status — do NOT commit; wait for Architect review + Sayeed's browser test.
After this, T8a (functional + styled) is complete → commit the whole of T8a → then T8b (Parties

- Settings) and T8c (Assets + Users) reuse this exact standard → Phase 1 done.
