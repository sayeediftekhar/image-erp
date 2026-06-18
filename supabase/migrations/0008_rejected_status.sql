-- ============================================================================
-- IMAGE ERP — Migration 0008: REJECTED status + rejection_reason (P1-T5e)
-- Iron Laws: L3 (audit-first — rejected entries are permanent record, never
--              deleted; the proposal-and-decline is part of the record)
--            L5 (role-based eligibility: ADMIN/HQ_FINANCE only)
-- Scope:
--   1. Widen journal_entries status CHECK to allow 'REJECTED'
--   2. Add rejection_reason text column (nullable; set by rejectEntry, null elsewhere)
--   3. Extend block_posted_mutation(): REJECTED is terminal — blocked from
--      UPDATE and DELETE with no allowed onward transition; POSTED logic
--      (POSTED→REVERSED sole-exception) is kept exactly as-is.
-- Append-only: 0001–0007 are never touched.
-- ============================================================================

-- 1. Widen status CHECK (drop + recreate; PostgreSQL has no ALTER CONSTRAINT
--    that can change a check expression).
--    Old: ('DRAFT','PENDING_APPROVAL','POSTED','REVERSED')
--    New: ('DRAFT','PENDING_APPROVAL','POSTED','REVERSED','REJECTED')
alter table public.journal_entries
  drop constraint journal_entries_status_check;

alter table public.journal_entries
  add constraint journal_entries_status_check
  check (status = any (array['DRAFT','PENDING_APPROVAL','POSTED','REVERSED','REJECTED']));

-- 2. rejection_reason: nullable, no default. Populated by rejectEntry; null on
--    all DRAFT / PENDING_APPROVAL / POSTED / REVERSED entries.
alter table public.journal_entries
  add column rejection_reason text;

-- 3. Extend block_posted_mutation to make REJECTED terminal.
--    CREATE OR REPLACE preserves the trigger bindings created in 0005.
--
--    Changes vs 0005:
--      journal_entries DELETE: also raise if OLD.status = 'REJECTED'
--      journal_entries UPDATE: raise unconditionally if OLD.status = 'REJECTED'
--        (REJECTED has NO allowed onward transition; POSTED still allows →REVERSED)
--      journal_lines: raise if parent status is 'POSTED' OR 'REJECTED'
--
--    Ordering note (unchanged from 0005): trg_journal_entries_immutable ('i')
--    fires BEFORE trg_journal_entries_touch ('t'). The to_jsonb comparison for
--    the POSTED→REVERSED check is unaffected by the new rejection_reason column:
--    POSTED entries always have rejection_reason = NULL, so both to_jsonb(OLD)
--    and to_jsonb(NEW) include "rejection_reason": null and the values match. ✓
create or replace function app.block_posted_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _parent_status text;
begin

  if TG_TABLE_NAME = 'journal_entries' then

    -- DELETE path ----------------------------------------------------------
    if TG_OP = 'DELETE' then
      if OLD.status = 'POSTED' then
        raise exception
          'journal entry % is POSTED and cannot be deleted — '
          'use a reversing entry to correct it (Iron Law 2)',
          OLD.id;
      end if;
      if OLD.status = 'REJECTED' then
        raise exception
          'journal entry % is REJECTED and is terminal — '
          'it cannot be deleted (Iron Law 3: audit-first)',
          OLD.id;
      end if;
      return OLD;
    end if;

    -- UPDATE path ----------------------------------------------------------

    -- REJECTED is fully terminal: no field change, no status transition.
    -- Checked before the POSTED block so each status's guard is self-contained.
    if OLD.status = 'REJECTED' then
      raise exception
        'journal entry % is REJECTED and is terminal — it cannot be modified',
        OLD.id;
    end if;

    if OLD.status = 'POSTED' then
      -- The only permitted mutation of a POSTED entry is the engine marking
      -- it REVERSED. Two conditions must both hold:
      --   (a) new status is REVERSED
      --   (b) no other column is changing (status is the sole difference)
      --
      -- ORDERING DEPENDENCY: condition (b) uses to_jsonb comparison and relies
      -- on this trigger (trg_journal_entries_immutable) firing BEFORE
      -- trg_journal_entries_touch ('i' < 't' alphabetically). At comparison
      -- time, touch_updated has NOT yet stamped updated_at/updated_by onto NEW,
      -- so they still equal their OLD values. If this trigger were renamed such
      -- that it fired AFTER touch, NEW.updated_at would already differ from
      -- OLD.updated_at and the comparison would incorrectly block the valid
      -- POSTED→REVERSED transition.
      if NEW.status = 'REVERSED'
         and to_jsonb(OLD) - 'status' = to_jsonb(NEW) - 'status'
      then
        return NEW;  -- engine is marking this entry reversed; allow
      end if;

      raise exception
        'journal entry % is POSTED and cannot be modified — '
        'use a reversing entry; only POSTED→REVERSED with no other field change is permitted',
        OLD.id;
    end if;

    return NEW;  -- DRAFT or PENDING_APPROVAL: all mutations allowed

  elsif TG_TABLE_NAME = 'journal_lines' then

    -- Lines are immutable whenever their parent entry is POSTED or REJECTED.
    -- POSTED: the entry is live and authoritative; lines cannot be changed.
    -- REJECTED: the decline is the permanent record; lines must be preserved.
    -- When a non-POSTED/non-REJECTED parent is being deleted (cascade), the
    -- parent row is already gone from the visible snapshot at this point, so
    -- the SELECT returns NULL → NULL not in ('POSTED','REJECTED') → allows.
    select status into _parent_status
      from public.journal_entries
     where id = OLD.entry_id;

    if _parent_status in ('POSTED', 'REJECTED') then
      raise exception
        'line % belongs to a % entry — '
        'lines of a posted or rejected entry cannot be modified or deleted',
        OLD.id, _parent_status;
    end if;

    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;

  end if;

  -- Fallback (not reached if attached only to the two intended tables)
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
