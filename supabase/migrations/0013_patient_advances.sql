-- ============================================================================
-- IMAGE ERP — Migration 0013: Patient Advances holding account, ageing setting,
-- and delivery_balance final-bill columns (P2-T2b)
--
-- C-section model correction: advance is cash held as a LIABILITY (2150),
-- not income. Income recognised only on discharge via closeDeliveryBalance.
-- NVD unchanged. safe_delivery removed (was a double-count cross-check sum).
-- ============================================================================

-- ---------- Account 2150 — Patient Advances / Deposits Received ---------------
-- Holding account: Dr 1010/PI at C-section admission; Cr 2150/PI.
-- Released on discharge: Dr 2150/PI in the close entry; income recognised then.
insert into public.accounts
  (code, name, type, normal_balance, fund, is_control, requires_approval, created_by)
values (
  '2150',
  'Patient Advances / Deposits Received',
  'LIABILITY', 'CREDIT', 'PI', false, false,
  '00000000-0000-0000-0000-000000000000'
)
on conflict (code) do nothing;

-- ---------- Setting: delivery_balance_flag_days --------------------------------
-- C-section stay is ~3 days; >4 days open = balance likely forgotten → flag.
-- Adjustable at pilot like all settings.
insert into public.settings (key, value, description, created_by)
values (
  'delivery_balance_flag_days',
  '4',
  'Days after admission (revenue_date) after which an OPEN delivery balance is flagged as overdue (C-section ~3-day stay; >4 days = escalate)',
  '00000000-0000-0000-0000-000000000000'
);

-- ---------- delivery_balance: add final-bill columns -------------------------
-- Populated by closeDeliveryBalance at discharge; NULL until status = CLOSED.
-- final_balance_paid: positive = additional cash received; negative = refund out.
-- close_entry_id: FK to the discharge journal entry (audit anchor).
--   ON DELETE RESTRICT: a posted discharge entry may not be deleted while any
--   delivery_balance row references it (preserves the audit trail).
alter table public.delivery_balance
  add column final_service_charge   numeric(15,2),
  add column final_rdf_amount       numeric(15,2),
  add column final_logistics_amount numeric(15,2),
  add column final_balance_paid     numeric(15,2),
  add column close_entry_id         uuid
    references public.journal_entries(id) on delete restrict;

create index on public.delivery_balance (close_entry_id)
  where close_entry_id is not null;
