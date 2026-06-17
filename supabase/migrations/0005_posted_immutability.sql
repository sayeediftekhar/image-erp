-- ============================================================================
-- IMAGE ERP — Migration 0005: Posted-entry immutability (P1-T4b)
-- Iron Laws: L2 (corrections are reversing entries, not edits or deletions)
--            L3 (no silent mutation of posted financial records)
-- Scope: POSTED status locks the entry and all its lines. DRAFT and
-- PENDING_APPROVAL remain freely editable. REVERSED is a terminal state
-- reached only via the permitted POSTED→REVERSED engine transition.
-- ============================================================================

-- Shared BEFORE trigger for both journal_entries and journal_lines.
-- SECURITY DEFINER so the parent-status lookup on journal_entries (for the
-- journal_lines branch) is not filtered by the caller's RLS policies.
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
      return OLD;
    end if;

    -- UPDATE path ----------------------------------------------------------
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

    -- Lines are immutable whenever their parent entry is POSTED.
    -- When a non-POSTED parent is being deleted (cascade), the parent row is
    -- already gone from the visible snapshot at this point, so the SELECT
    -- returns NULL → NULL ≠ 'POSTED' → cascade proceeds normally.
    select status into _parent_status
      from public.journal_entries
     where id = OLD.entry_id;

    if _parent_status = 'POSTED' then
      raise exception
        'line % belongs to a POSTED entry — '
        'lines of a posted entry cannot be modified or deleted',
        OLD.id;
    end if;

    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;

  end if;

  -- Fallback (not reached if attached only to the two intended tables)
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

create trigger trg_journal_entries_immutable
  before update or delete on public.journal_entries
  for each row execute function app.block_posted_mutation();

create trigger trg_journal_lines_immutable
  before update or delete on public.journal_lines
  for each row execute function app.block_posted_mutation();
