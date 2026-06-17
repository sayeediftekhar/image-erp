-- ============================================================================
-- LOCAL TEST SHIM — emulates the Supabase runtime on plain Postgres.
-- NOT shipped to Supabase (Supabase already provides all of this).
-- Run this BEFORE the migration when testing locally.
-- ============================================================================

-- Supabase roles. authenticated = any logged-in user; service_role bypasses RLS.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- auth schema + auth.uid(), mirroring Supabase: read the 'sub' claim from the
-- request JWT, which we simulate via the request.jwt.claims GUC.
create schema if not exists auth;

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid;
$$;

-- minimal stand-in for auth.users so FKs/joins behave like Supabase
create table if not exists auth.users (id uuid primary key);

-- test helper: "log in" as a given user id (sets the simulated JWT sub claim)
create or replace function auth.login_as(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false);
end $$;

-- test helper: "log out" (no JWT → auth.uid() is null)
create or replace function auth.logout()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
end $$;
