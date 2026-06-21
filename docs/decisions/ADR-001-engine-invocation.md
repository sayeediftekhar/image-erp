# ADR-001 — Posting Engine Invocation Pattern

**Status:** ACCEPTED  
**Date:** 2026-06-21  
**Decider:** Sayeed  
**Scope:** Every manager write that reaches the posting engine — T3a mark-closed, T3b–d wizard submit, T3e close-balance, expense form, and all future manager writes.

---

## Context

The posting engine (`LedgerService`, `RevenueService`) lives in `apps/api/src/` as NestJS-decorated service classes. It has only ever been exercised by Jest tests and a one-off verify script — both use direct constructor instantiation, bypassing NestJS DI entirely. No HTTP controllers exist. No NestJS server process has ever run at runtime; the current deployment is Next.js on Vercel + Supabase Postgres.

Starting with T3a, the Next.js web app needs a server-side path to call `submitRevenueDay`. That path will be reused by every subsequent manager write. Choosing it now sets the pattern for the whole wizard.

**Constraints active:**
- Iron Law 2: nothing writes `journal_lines` except the posting engine.
- Iron Law 3: every monetary write carries `created_by` + audit trail.
- Deployment: Vercel (Next.js) + Supabase Postgres. No persistent sidecar server today.
- Guidelines §3: "NestJS for backend/business logic; Supabase + Vercel."
- Time budget: ~7 hrs/week; operational complexity has a real cost.

---

## Options evaluated

### Option 1 — NestJS as a separate HTTP service

Add NestJS controllers. Run `apps/api` as a separate HTTP service (Railway / Render / fly.io, or a Vercel serverless wrapper via `@nestjs/platform-serverless-http`). Next.js route handlers POST to it.

**Pros**
- Literally honours Guidelines §3 ("NestJS for business logic").
- Clean HTTP boundary; future mobile client or third-party caller just hits the same endpoints.
- NestJS guards, pipes, interceptors available if/when needed.

**Cons**
- Second deployment target. Vercel serverless NestJS (`@nestjs/platform-serverless-http`) is non-standard and poorly maintained; a persistent host (Railway etc.) adds cost.
- Two processes in local dev; needs `concurrently` or manual coordination.
- Auth must cross the boundary: Next.js validates the Supabase JWT, then passes `actor_id` to NestJS (which must trust it) — or NestJS re-validates the JWT, which doubles the Supabase auth call.
- Two pg connection pools to the same Supabase instance.
- Cold-start latency on a serverless wrapper.
- Disproportionate ops burden for a 7-hr/week project at this stage.

**Verdict:** Right if this grows into a multi-client system. Premature for the current scope and deployment.

---

### Option 2 — Import NestJS services directly into Next.js (workspace dep + transpilePackages)

Add `"@image-erp/api": "workspace:*"` to `apps/web`. Add `transpilePackages: ['@image-erp/api']` to `next.config.mjs`. Route handlers instantiate `LedgerService` and `RevenueService` directly, same as tests.

**Pros**
- Single process, Vercel-native, no second server.
- Zero migration — uses existing service files as-is.

**Cons**
- `@Injectable()` and `@Inject()` are used outside the NestJS DI container. The decorators are pure metadata today (no lifecycle hooks used), so no runtime failure — but the annotation is an architectural lie.
- `@nestjs/common` enters the Next.js webpack build transitively. Risk of webpack pulling in Express platform code or other Node.js-incompatible server modules, causing a non-obvious build failure that only surfaces on `next build`.
- Cross-app dependency (`apps/web` → `apps/api`): violates the monorepo convention that apps don't depend on each other.
- Import paths must change again if the engine is ever extracted or an HTTP layer is added.

**Verdict:** Works as a short-term hack. The `@nestjs/common`-under-webpack risk is real and untested; the architectural dishonesty compounds over T3b–e.

---

### Option 3 — Extract `packages/posting-engine` (plain TypeScript, no `@nestjs/*`)

Move `ledger.types.ts`, `draft-data.schema.ts`, `ledger.service.ts`, `revenue.service.ts` into a new workspace package `packages/posting-engine`. Strip the four `@Injectable()`/`@Inject()` decorator lines (they add zero behaviour — the services have always been directly instantiated). The package's only runtime deps are `pg` and `zod`.

Both `apps/api` (if kept as a thin wrapper or for future HTTP controllers) and `apps/web` (route handlers) import from `@image-erp/posting-engine`. Jest tests update their import path — the test logic is unchanged.

**Pros**
- Architecturally honest: the engine is the most important component in the system (Iron Law 2 makes it the sole journal writer). It deserves to be a first-class, independently importable package, not embedded inside whichever app happens to host it.
- No `@nestjs/*` in the web webpack build: no transpilePackages risk, no surprise build failures.
- Vercel-native: plain TypeScript, `pg`, `zod` — all webpack-safe.
- Single import path for all callers: Jest, web route handlers, future Expo. One source of truth.
- `reflect-metadata` no longer needed in `apps/web` (no NestJS decorators).
- If a NestJS HTTP API is added later, `apps/api` re-exports from the engine package behind controllers — the engine code does not change.
- `transpilePackages: ['@image-erp/posting-engine']` is still needed (source-only package, no build step), but the risk is zero: `pg` and `zod` are both webpack-safe Node.js packages.

**Cons**
- One-time migration: ~30 min to create the package, move 4 files, strip 4 decorator lines, update ~8 import paths in `apps/api` (module files + test imports).
- One new `package.json` + `tsconfig.json` to maintain.

**Verdict:** The right long-term foundation. Cost is low; benefit is permanent.

---

## Decision

**Option 3 — extract `packages/posting-engine`.**

The Guidelines §3 states "NestJS for business logic," which was being read as "NestJS DI + HTTP server." The actual intent is that business logic lives in typed services with clear interfaces, tested in isolation — `packages/posting-engine` achieves this with no framework overhead. The NestJS decorators were adding zero behaviour to classes that have always been directly instantiated; removing them is honest, not lossy.

The engine is Iron Law 2's enforcer: the sole writer of `journal_lines`. It deserves to be a first-class package, not a tenant inside an app directory.

---

## Consequences

### Pre-T3a migration (one-time, ~30 min)

1. Create `packages/posting-engine/` with `package.json` (name `@image-erp/posting-engine`, deps `pg` + `zod`), `tsconfig.json` (extends root), `src/`.
2. Move into `packages/posting-engine/src/`:
   - `apps/api/src/ledger/ledger.types.ts`
   - `apps/api/src/ledger/ledger.service.ts`
   - `apps/api/src/revenue/draft-data.schema.ts`
   - `apps/api/src/revenue/revenue.service.ts`
3. Strip from the two service files: `import { Injectable, Inject } from '@nestjs/common'`, `@Injectable()`, `@Inject(DATABASE_POOL)`. Constructors become plain TypeScript parameters.
4. Update `apps/api/src/`:
   - `ledger/ledger.module.ts` — import `LedgerService` from `@image-erp/posting-engine`; keep NestJS provider wrapper so the module compiles.
   - `revenue/revenue.module.ts` — same pattern.
   - `database/database.providers.ts` — unchanged (DATABASE_POOL token still used by NestJS wrappers if `apps/api` is kept).
5. Update `apps/api/test/revenue.service.spec.ts` import paths to `@image-erp/posting-engine`.
6. `apps/web/package.json`: add `"@image-erp/posting-engine": "workspace:*"` and `"pg": "^8.13.0"`.
7. `apps/web/next.config.mjs`: add `transpilePackages: ['@image-erp/posting-engine']`.
8. Run the full Jest suite (`pnpm --filter api test`) to confirm green.

### T3a and onwards

- `apps/web/src/lib/posting/client.ts` imports `LedgerService`, `RevenueService` from `@image-erp/posting-engine`.
- All future manager write routes follow the same pattern.

### Deferred

- Whether `apps/api` is simplified or archived. It can remain as thin NestJS wrappers re-exporting from the engine package — no code duplication, and the HTTP path exists if needed later.
- Whether a NestJS HTTP controller layer is ever added. If it is, `apps/api` controllers import from `@image-erp/posting-engine` — the engine itself does not change.
