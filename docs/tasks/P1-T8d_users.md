# Task Spec — P1-T8d: Users page (+ secure server-side create-user route)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

> Scope: the Users admin page (manage app_users: create, assign role+clinic, deactivate) PLUS
> the server-side API route that creates the Supabase Auth account, because that needs the
> service key which must NOT be in the browser. This is the LAST Phase 1 task.
> Reuses the T8a shell/responsive/styling. Touch no engine/ledger/posting logic.

## The core constraint (why this task has a server route)

Creating a user = TWO things: a Supabase **Auth account** (email+password → they can log in) AND
an `app_users` row (role+entity → RLS knows what they can do). Creating an Auth account requires
the Supabase **service/secret key**, which is server-only and MUST NEVER reach the browser. So
the browser cannot create the auth user directly. A small **server-side route** holds the key and
does the privileged work. The browser just calls it.

## Part 1 — The server-side create-user route

A Next.js Route Handler (e.g. `apps/web/src/app/api/admin/create-user/route.ts`) — runs on the
SERVER, holds the service key in a **server-only env var** (e.g. `SUPABASE_SERVICE_ROLE_KEY` in
`.env.local`, NOT prefixed `NEXT_PUBLIC_`, so it never ships to the browser).

**SECURITY — non-negotiable, this route wields the secret key:**

1. **Verify the caller is an admin BEFORE doing anything.** On every request: read the caller's
   session (the `@supabase/ssr` server client + their cookie), get their user via `getUser()`,
   look up their `app_users` row, confirm `role = 'ADMIN'` and active. If not admin (or no
   session) → return 403, do nothing. This check is the first thing the handler does; nothing
   privileged runs before it passes.
2. The service-key client is created ONLY inside this handler (server-side), never exported to
   or importable by client code.
3. The route accepts: email, password, full_name, role, entity_id (entity_id required iff
   role=ENTRY, null otherwise — validate with Zod server-side, don't trust the client).

**The two-step create must not leave an orphan (atomic-ish):**

1. Create the Auth user via the service-key admin API (`auth.admin.createUser`, email+password,
   email_confirm=true so the account is immediately usable).
2. Insert the matching `app_users` row (id = the new auth user's id, role, entity_id, full_name,
   active=true).
3. **If step 2 fails, delete the auth user created in step 1** (`auth.admin.deleteUser`) so there's
   no login-without-a-role orphan. Report the error. (Best-effort cleanup; if cleanup itself
   fails, surface a clear message so Sayeed can resolve it in the dashboard.)
4. On success return the created user (without password).

**Zod validation server-side** (never trust the client): valid email, password ≥ 8 (matches the
auth setting), role in the enum, entity_id present iff ENTRY (mirror the DB check constraint).

## Part 2 — The Users page (`/users`)

CRUD-ish on `app_users`, reusing the table/cards/modal pattern. Reads go direct via Supabase
(the `app_users` RLS lets ADMIN read all). Creating a user calls the **route** (Part 1). Editing
role/entity and deactivating are direct Supabase updates on `app_users` (admin-write RLS).

**Table / cards columns:** full_name, email (from auth — see note), role (badge), entity (clinic
code for ENTRY, "all entities" for others), status (active/inactive), actions (Edit / Deactivate).

- Email note: email lives in `auth.users`, not `app_users`. Either (a) store/display full_name
  and show email only where available, or (b) the create-route can also write the email into an
  `app_users` column if one exists — CHECK the schema; if app_users has no email column, display
  full_name + role + entity and treat email as set-at-creation only (shown in a read-only way if
  fetchable). Decide in the plan based on the actual app_users columns. Do NOT add a migration
  just for this unless trivial — prefer displaying what app_users already has.

**Create user (modal → calls the route):**

- Fields: full_name, email, password (with the ≥8 rule surfaced), role (select), entity (clinic
  select, shown ONLY when role=ENTRY — enforce the same constraint the DB has).
- On submit → POST to `/api/admin/create-user` → on success, refetch the user list; on error,
  show the route's message.
- Password handling: the admin sets an initial password here (per the decided model — Sayeed
  sets credentials). It's sent to the server route over the request; it is NOT stored anywhere
  in the client or logged. (Acknowledge: this is an admin setting an initial password; fine for
  the internal-users model.)

**Edit user (direct Supabase update on app_users):**

- Change role and/or entity (enforce ENTRY⇔entity_id rule client-side AND it's enforced by the DB
  check constraint). Cannot change email/password here (that's an auth concern — out of scope;
  password resets can be a later feature or dashboard action).
- Reuse modal styling, error mapping.

**Deactivate / reactivate:** set `app_users.active = false/true` (direct update). A deactivated
user's role helpers (`app.current_role()` etc.) already filter on `active` — so deactivating
immediately removes their access. NOTE: this deactivates their app-role; their Auth login still
exists (they could authenticate but resolve to no active role → effectively locked out). That's
acceptable; full auth-disable is a later refinement. Document this.

**Guard rails for self:** an admin should not be able to deactivate/demote THEMSELVES into
lockout (don't let the only admin remove their own admin access and lock the org out). At minimum:
prevent deactivating your own currently-logged-in account; ideally warn if demoting the last
active admin. Decide the simplest safe rule in the plan.

## Part 3 — Wire into nav

- The "Users" SideNav stub (under Administration) becomes a real active link to `/users`.

## Iron Laws / security in play

- **Service key server-only** — in the route, in a non-`NEXT_PUBLIC_` env var, never in any
  client file. `grep -r "service_role\|SERVICE_ROLE" apps/web/src/app/(admin)` must be clean;
  the key appears only in the server route + `.env.local` (gitignored).
- **The route checks admin on every call** before privileged work (403 otherwise).
- L5 — app_users reads/writes via the existing RLS; ENTRY⇔entity constraint enforced.
- L3 — created users are attributed; the create is an admin action.

## Applicable LEARNINGS

- app_users.id = the Supabase auth.users.id (same uuid) — the route inserts the app_users row
  with id = the new auth user's id.
- Service connection / service key bypasses RLS — that's why the route must do its OWN admin check.
- ENTRY users must have entity_id; ADMIN/HQ_FINANCE/READ_ONLY must not (DB check constraint).
- The bootstrap admin (Sayeed) already exists — this page creates everyone AFTER him.

## Acceptance (Sayeed verifies in browser)

1. /users loads, shows at least the bootstrap admin (Sayeed, ADMIN). Nav link works.
2. **Create an ENTRY user**: full_name, email, password (≥8), role=ENTRY → a clinic dropdown
   appears → pick a clinic → submit → user created (no error); appears in the list.
3. **Log out, log in as that new user** → they reach the panel and resolve to ENTRY/their clinic
   (proves the auth account + app_users row were both created correctly). Then log back in as admin.
4. Create an ADMIN/HQ_FINANCE user → NO clinic dropdown (entity must be null); created fine.
5. Edit a user's role; deactivate a user → they can no longer access (role resolves inactive);
   reactivate.
6. Self-protection: cannot deactivate your own logged-in admin account (blocked with a message).
7. A non-admin cannot hit the create-user route (it 403s) — even if they tried directly.
8. `grep -r "SERVICE_ROLE\|service_role" apps/web/src` → key only in the server route file (env
   read), never in client components; app compiles.

## On completion

End with exactly one status — do NOT commit; wait for Architect review + Sayeed's browser test
(including the create-a-user-and-log-in-as-them test, which is the real proof).
**After T8d, Phase 1 is COMPLETE** — the full backend (ledger, engine, all migrations), auth, and
the admin panel (Accounts, Parties, Settings, Assets, Users) are built and deployed. Next: Phase 2
— the manager entry forms (mobile-first; the ui-ux standard + responsive patterns established in
T8 carry in; review the current manager Google Form first).
