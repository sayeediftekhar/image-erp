# Task Spec — P1-T0auth: Authentication (Next.js + Supabase Auth, bootstrap admin)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: get a real person logged in, with a session, such that `auth.uid()` flows through
> and RLS recognises their role. This is the foundation T8 (and everything visual) sits on.
> NOT in this task: the admin CRUD panel itself (T8), the Users-management page (T8), manager
> entry forms (Phase 2). This task is login + session + the bootstrap admin only.

## Problem (one sentence)

There is no way to log in yet; build Supabase Auth into a Next.js app so a real authenticated
user's id reaches the database (making RLS fire for a real person), and bootstrap Sayeed as
the first ADMIN.

## Setup (first frontend app)

- Scaffold a Next.js 14 (App Router) app at `apps/web` in the pnpm monorepo (alongside
  `apps/api`). TypeScript.
- Use `@supabase/supabase-js` + `@supabase/ssr` (the SSR helper for Next.js App Router session
  handling). Confirm the current recommended Supabase-Next.js auth pattern in the plan.
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the ANON key — RLS-bound,
  safe in the browser). **The service_role key NEVER appears in apps/web** — it stays in
  apps/api only. State this explicitly.

## What to build

1. **Login screen** (`/login`) — email + password (Supabase `signInWithPassword`). Clear error
   on bad credentials. No sign-up screen — users are created by the admin later (T8); there is
   no public registration.
2. **Session handling** — the logged-in session persists across page loads (SSR cookie-based
   via `@supabase/ssr`). A `logout` action.
3. **Protected route** — a placeholder authed page (e.g. `/dashboard`) that is only reachable
   when logged in; an unauthenticated visitor is redirected to `/login`. Middleware or a server
   check — confirm approach in plan.
4. **Role/identity resolution** — once logged in, the app can read the current user's row from
   `app_users` (id = `auth.uid()`) to know their role + entity. Show it on the placeholder page
   (e.g. "Logged in as Sayeed — ADMIN") to prove `auth.uid()` → `app_users` resolution works
   end-to-end through RLS (the `app_users_self_read` policy from T1 lets a user read their own row).

## The bootstrap admin (the chicken-and-egg)

There must be one ADMIN who exists before any UI can create users. Steps (document them as a
runbook in the plan; this is partly a manual/console step Sayeed does, partly code):

1. Create Sayeed's user in Supabase Auth (via the Supabase dashboard Auth UI, or a one-off
   script) — real email + password Sayeed sets.
2. Insert the matching `public.app_users` row: `id` = that auth user's uuid, `role = 'ADMIN'`,
   `entity_id = null`, `active = true`. (Done once via SQL/console — there is no UI yet.)
3. Verify: log in as Sayeed in the web app → the placeholder page shows role ADMIN, proving
   `auth.uid()` resolves to the app_users row through RLS.

- This is a documented one-time bootstrap, NOT a seed in a migration (it's a real person's
  account, environment-specific, not committed). Note clearly in CONTEXT how it was done.

## Security settings (do as part of this task)

- Bump `minimum_password_length` to **8** in `supabase/config.toml` (was 6). Note: for the
  hosted project this is also set in the dashboard Auth settings — flag that the config.toml
  change applies to local; confirm the hosted setting is changed too.

## Iron Laws / security in play

- The **service_role key is server-only** — never in `apps/web`, never in the browser bundle.
  The web app uses only the anon key; RLS does the rest. This is the crown-jewel rule.
- RLS (L5) is what makes a real login safe: `auth.uid()` from the session drives every policy.
- No public sign-up — users are admin-created (T8). Login only.

## Applicable LEARNINGS

- `app_users.id` = the Supabase `auth.users.id` (same uuid). The role helpers
  (`app.current_role()`, `app.is_admin()`) read `app_users` by `auth.uid()`.
- `app_users_self_read` (T1) lets an authenticated user read their own row — that's how the
  app resolves "who am I".
- Service connection vs anon: the web app is anon-key + user session (RLS applies); the engine
  (apps/api) is service_role (RLS bypassed). Two different access contexts, by design.

## Done-criteria

1. `apps/web` Next.js app runs; `/login` renders.
2. Logging in with the bootstrap admin's credentials succeeds; session persists across reload.
3. `/dashboard` (or placeholder) is reachable ONLY when logged in; logged-out → redirect to /login.
4. The placeholder page shows the logged-in user's role (ADMIN) read from `app_users` via
   `auth.uid()` — proving end-to-end identity→RLS resolution.
5. Logout works; after logout the protected route redirects to /login.
6. Confirmed: no service_role key anywhere in apps/web (grep the build/source).
7. `minimum_password_length` = 8 (local config + note re: hosted dashboard setting).

> Testing note: this is the first UI task — automated tests cover what they can (auth helper
> logic, the protected-route redirect), but the real acceptance is Sayeed logging in in a
> browser and seeing "ADMIN". UI verification is part of the loop now, not just assertions.

## On completion

End with exactly one status — do NOT commit; wait for Architect review + Sayeed's browser test.
Next: T8 — the admin panel (reference-data CRUD direct to Supabase via RLS + the Users page
where Sayeed creates everyone else).
