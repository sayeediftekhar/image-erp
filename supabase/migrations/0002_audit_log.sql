-- ============================================================================
-- IMAGE ERP — Migration 0002: Audit infrastructure (P1-T2)
-- Creates: audit schema, audit.audit_log, audit.log_change() trigger function
-- Trigger attached to: entities, accounts, parties, app_users
-- Iron Laws: L3 (every write attributed), L5 (RLS on audit.audit_log)
--
-- SECURITY DEFINER note: Build Guidelines §2 says "INSERT-only" for the app
-- role. This migration goes stronger: SECURITY DEFINER trigger + zero direct
-- grant means authenticated cannot forge or contaminate an audit row at all.
-- Same append-only intent, unforgeable guarantee. Deliberate deviation confirmed
-- in the plan review before build.
-- ============================================================================

-- ---------- app schema USAGE grant (belongs here, not in 0001) --------------
-- Supabase grants authenticated/anon usage on the app schema automatically;
-- local Postgres does not. This was surfaced by T2 tests and belongs in the
-- next migration after 0001 rather than editing that already-committed file.
grant usage on schema app to authenticated, anon;

-- ---------- audit schema + table ---------------------------------------------
create schema if not exists audit;

create table audit.audit_log (
  id          bigint      generated always as identity primary key,
  table_name  text        not null,
  record_id   text        not null,
  op          text        not null check (op in ('INSERT','UPDATE','DELETE')),
  old_json    jsonb,
  new_json    jsonb,
  actor       uuid,
  at          timestamptz not null default now()
);

-- ---------- generic audit trigger function -----------------------------------
-- SECURITY DEFINER: runs as the table owner (postgres), bypassing RLS and all
-- grants. authenticated has zero direct write path to audit.audit_log; this
-- trigger is the sole writer. search_path locked to prevent injection.
create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = public, audit, auth
as $$
declare
  _record_id  text;
  _actor      uuid;
  _old_json   jsonb;
  _new_json   jsonb;
  _system     constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- Capture row snapshots via explicit branches to avoid accessing NEW on DELETE
  -- or OLD on INSERT (those pseudorecords are undefined for those ops).
  if TG_OP = 'INSERT' then
    _old_json := null;
    _new_json := to_jsonb(new);
  elsif TG_OP = 'DELETE' then
    _old_json := to_jsonb(old);
    _new_json := null;
  else  -- UPDATE
    _old_json := to_jsonb(old);
    _new_json := to_jsonb(new);
  end if;

  -- Extract PK as text via jsonb (safe for any row type; no direct field access).
  -- accounts uses text 'code' as its primary key; all other attached tables use
  -- uuid 'id'. REVISIT: if a future text-keyed table is attached here, extend
  -- this branch rather than relying on the else clause.
  if TG_TABLE_NAME = 'accounts' then
    _record_id := coalesce(_new_json->>'code', _old_json->>'code');
  else
    _record_id := coalesce(_new_json->>'id', _old_json->>'id');
  end if;

  -- Resolve actor: prefer live session uid, then row attribution columns (via
  -- jsonb so tables without created_by/updated_by, e.g. app_users, are safe),
  -- then SYSTEM sentinel. Final _system coalesce guarantees actor is never null.
  if TG_OP = 'INSERT' then
    _actor := coalesce(
      auth.uid(),
      (_new_json->>'created_by')::uuid,
      _system
    );
  elsif TG_OP = 'UPDATE' then
    _actor := coalesce(
      auth.uid(),
      (_new_json->>'updated_by')::uuid,
      (_new_json->>'created_by')::uuid,
      (_old_json->>'updated_by')::uuid,
      _system
    );
  else  -- DELETE
    _actor := coalesce(
      auth.uid(),
      (_old_json->>'updated_by')::uuid,
      (_old_json->>'created_by')::uuid,
      _system
    );
  end if;

  insert into audit.audit_log (table_name, record_id, op, old_json, new_json, actor)
  values (TG_TABLE_NAME, _record_id, TG_OP, _old_json, _new_json, _actor);

  return null;  -- AFTER trigger; return value is ignored for row-level AFTER triggers
end $$;

-- ---------- attach triggers --------------------------------------------------
create trigger trg_entities_audit
  after insert or update or delete on public.entities
  for each row execute function audit.log_change();

create trigger trg_accounts_audit
  after insert or update or delete on public.accounts
  for each row execute function audit.log_change();

create trigger trg_parties_audit
  after insert or update or delete on public.parties
  for each row execute function audit.log_change();

create trigger trg_app_users_audit
  after insert or update or delete on public.app_users
  for each row execute function audit.log_change();

-- ---------- schema access + append-only enforcement --------------------------
grant usage on schema audit to authenticated, anon;
-- authenticated may SELECT (filtered by RLS below); the trigger is the only writer.
grant select on audit.audit_log to authenticated;
-- Explicit revoke makes append-only intent clear and guards against accidental
-- future grants. INSERT/UPDATE/DELETE/TRUNCATE were never granted on this schema,
-- so this is idempotent but authoritative as a statement of policy.
revoke insert, update, delete, truncate on all tables in schema audit
  from authenticated, anon;

-- ---------- RLS: oversight roles SELECT only; no write policy for anyone -----
alter table audit.audit_log enable row level security;

-- ADMIN, HQ_FINANCE, READ_ONLY may read the full audit trail. ENTRY may not.
create policy audit_log_read on audit.audit_log
  for select to authenticated
  using (app.current_role() in ('ADMIN', 'HQ_FINANCE', 'READ_ONLY'));

-- No INSERT / UPDATE / DELETE RLS policy exists. The SECURITY DEFINER trigger
-- bypasses RLS as owner and is the sole writer. Any direct write attempt fails
-- at the grant level before RLS is even evaluated.
