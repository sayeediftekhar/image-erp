-- ============================================================================
-- IMAGE ERP — Migration 0010: fixed_assets write policy (P1-T8c)
--
-- Gap closed: migration 0009 granted SELECT only to authenticated on
-- fixed_assets, expecting a service_role write path. T8c spec calls for
-- Next.js → Supabase via RLS (same pattern as accounts/parties/settings),
-- which requires an ADMIN-scoped write policy + DML grant.
--
-- Guard (Iron Law 1): accumulated_depreciation is NEVER in the INSERT or
-- UPDATE payloads from the T8c admin panel. The INSERT omits the column
-- (DB default = 0). The UPDATE omits it. Phase 4 service_role is the sole
-- writer of that column. A DB trigger enforcing this at the authenticated
-- level is deferred to Phase 4 — it belongs alongside the depreciation run
-- that is the sole legitimate updater.
-- ============================================================================

create policy fixed_assets_write on public.fixed_assets
  for all    to authenticated
  using     (app.is_admin())
  with check (app.is_admin());

grant insert, update, delete on public.fixed_assets to authenticated;
