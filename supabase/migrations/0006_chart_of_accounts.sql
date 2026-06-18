-- ============================================================================
-- IMAGE ERP — Migration 0006: Chart of accounts (P1-T6)
-- Iron Laws: L3 (SYSTEM actor on all seed inserts), L4 (correct fund per account)
--
-- Sequencing note: this migration ships BEFORE the posting engine (P1-T5).
-- Original task numbering had engine=T5, chart=T6, but the build dependency is
-- accounts→transactions; T5 (engine) is built against this real chart afterward.
-- ============================================================================

-- ---------- Step 1: add requires_approval column (append-only) ---------------
-- The posting engine (T5) routes an entry to PENDING_APPROVAL if ANY line's
-- account has requires_approval = true, in addition to the value-threshold and
-- is-reversal checks. No RLS or grant changes needed — accounts already has
-- full grants and RLS from 0001. The audit trigger (0002) logs each seed INSERT
-- with record_id = code (text-PK waterfall in audit.log_change()).
alter table public.accounts
  add column requires_approval boolean not null default false;

-- ---------- Step 2: seed the full chart (idempotent) -------------------------
-- normal_balance is set EXPLICITLY per row — never derived from type.
-- 1590 Accumulated Depreciation: type=ASSET / normal_balance=CREDIT (contra-asset).
--
-- fund = NULL for "any/—" accounts: fund resolves on the journal line at posting
-- time, not on the account definition. Key confirmed cases:
--
--   1190 EXIM STD — FROZEN (fund=NULL, confirmed Sayeed 2026-06-18): the sole
--   live function is sweeping the frozen EXIM balance to HQ's AB Bank (1130),
--   a cross-fund movement (PI→HQ). Fixing fund=PI here would make that sweep
--   unpostable; NULL lets each line carry its correct fund.
--
--   4210 Bank Interest (fund=NULL): different entities earn interest into
--   different funds (PI, RDF, HQ), so fund must resolve on the line.
insert into public.accounts
  (code, name, type, normal_balance, fund, is_control, requires_approval, created_by)
values
  -- ASSETS (1000s) — normal_balance DEBIT except 1590 which is CREDIT ----------
  ('1010','Cash in Hand — PI',                                  'ASSET','DEBIT',  'PI',      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1015','Cash — Petty Cash Float',                            'ASSET','DEBIT',  'PI',      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1020','Cash in Hand — RDF',                                 'ASSET','DEBIT',  'RDF',     false,false,'00000000-0000-0000-0000-000000000000'),
  ('1110','SJIB Current — PI',                                  'ASSET','DEBIT',  'PI',      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1120','SJIB SND — RDF',                                     'ASSET','DEBIT',  'RDF',     false,false,'00000000-0000-0000-0000-000000000000'),
  ('1130','AB Bank — HQ Operating',                             'ASSET','DEBIT',  'HQ',      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1140','UCB — HQ',                                           'ASSET','DEBIT',  'HQ',      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1190','EXIM STD — FROZEN',                                  'ASSET','DEBIT',  null,      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1210','RDF Stock — Medicines',                              'ASSET','DEBIT',  'RDF',     false,false,'00000000-0000-0000-0000-000000000000'),
  ('1220','RDF Stock — Lab',                                    'ASSET','DEBIT',  'RDF',     false,false,'00000000-0000-0000-0000-000000000000'),
  ('1230','RDF Stock — Logistic',                               'ASSET','DEBIT',  'RDF',     false,false,'00000000-0000-0000-0000-000000000000'),
  ('1310','Accounts Receivable (Control)',                       'ASSET','DEBIT',  null,      true, false,'00000000-0000-0000-0000-000000000000'),
  ('1320','Patient Receivable — C-Section Balances',            'ASSET','DEBIT',  'PI',      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1410','Inter-Clinic / HQ Loan Receivable (Control)',        'ASSET','DEBIT',  null,      true, true, '00000000-0000-0000-0000-000000000000'),
  ('1510','Fixed Assets — Furniture & Equipment',               'ASSET','DEBIT',  null,      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1520','Investments — FDR / MIDS (Control)',                 'ASSET','DEBIT',  'HQ',      true, true, '00000000-0000-0000-0000-000000000000'),
  ('1530','Leasehold / Building Improvements',                  'ASSET','DEBIT',  null,      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1590','Accumulated Depreciation',                           'ASSET','CREDIT', null,      false,false,'00000000-0000-0000-0000-000000000000'),
  ('1610','TB Care — SJIB (Restricted)',                        'ASSET','DEBIT',  'TB_CARE', false,false,'00000000-0000-0000-0000-000000000000'),
  -- LIABILITIES (2000s) — normal_balance CREDIT ---------------------------------
  ('2010','Accounts Payable — Suppliers (Control)',             'LIABILITY','CREDIT','RDF',     true, false,'00000000-0000-0000-0000-000000000000'),
  ('2110','Salaries Payable',                                   'LIABILITY','CREDIT','PI',      false,false,'00000000-0000-0000-0000-000000000000'),
  ('2120','Doctor / Consultant Fees & Allowances Payable',      'LIABILITY','CREDIT','PI',      false,false,'00000000-0000-0000-0000-000000000000'),
  ('2210','Inter-Clinic / HQ Loan Payable (Control)',           'LIABILITY','CREDIT', null,     true, true, '00000000-0000-0000-0000-000000000000'),
  ('2310','Other Payables / Accruals',                          'LIABILITY','CREDIT', null,     false,false,'00000000-0000-0000-0000-000000000000'),
  ('2410','TB Care — Funds Held / Rent Clearing',               'LIABILITY','CREDIT','TB_CARE', false,false,'00000000-0000-0000-0000-000000000000'),
  -- FUND / EQUITY (3000s) — normal_balance CREDIT; all require approval ---------
  ('3010','Fund Balance — PI',                  'FUND','CREDIT','PI',      false,true, '00000000-0000-0000-0000-000000000000'),
  ('3020','Fund Balance — RDF',                 'FUND','CREDIT','RDF',     false,true, '00000000-0000-0000-0000-000000000000'),
  ('3030','Fund Balance — HQ-General',          'FUND','CREDIT','HQ',      false,true, '00000000-0000-0000-0000-000000000000'),
  ('3040','Fund Balance — TB Care (Restricted)','FUND','CREDIT','TB_CARE', false,true, '00000000-0000-0000-0000-000000000000'),
  ('3900','Inter-Fund Transfer (clearing)',      'FUND','CREDIT', null,     false,true, '00000000-0000-0000-0000-000000000000'),
  -- INCOME (4000s) — normal_balance CREDIT --------------------------------------
  ('4010','PI — Outdoor',                        'INCOME','CREDIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('4020','PI — NVD',                            'INCOME','CREDIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('4030','PI — C-Section',                      'INCOME','CREDIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('4040','PI — Satellite',                      'INCOME','CREDIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('4050','PI — USG',                            'INCOME','CREDIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('4090','PI — Other Income',                   'INCOME','CREDIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('4110','RDF — Medicine Sales',                'INCOME','CREDIT','RDF',  false,false,'00000000-0000-0000-0000-000000000000'),
  ('4120','RDF — Lab',                           'INCOME','CREDIT','RDF',  false,false,'00000000-0000-0000-0000-000000000000'),
  ('4130','RDF — Logistic',                      'INCOME','CREDIT','RDF',  false,false,'00000000-0000-0000-0000-000000000000'),
  ('4210','Bank Interest (operating a/cs)',       'INCOME','CREDIT', null,  false,false,'00000000-0000-0000-0000-000000000000'),
  ('4220','Investment Income — FDR/MIDS (gross)','INCOME','CREDIT','HQ',   false,true, '00000000-0000-0000-0000-000000000000'),
  -- EXPENSES (5000s) — normal_balance DEBIT ------------------------------------
  ('5010','Salaries',                                              'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5020','Fringe Benefits',                                       'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5030','Fees / Honorarium',                                     'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5040','General Admin',                                         'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5050','Travel',                                                'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5060','Supplies',                                              'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5070','Purchased Services',                                    'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5080','Education',                                             'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5090','Performance',                                           'EXPENSE','DEBIT','PI',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5110','Repairs & Maintenance — Building',                      'EXPENSE','DEBIT', null,  false,false,'00000000-0000-0000-0000-000000000000'),
  ('5120','Repairs & Maintenance — Vehicle',                       'EXPENSE','DEBIT', null,  false,false,'00000000-0000-0000-0000-000000000000'),
  ('5130','Depreciation Expense',                                  'EXPENSE','DEBIT', null,  false,false,'00000000-0000-0000-0000-000000000000'),
  ('5210','RDF COGS — Medicines',                                  'EXPENSE','DEBIT','RDF',  false,false,'00000000-0000-0000-0000-000000000000'),
  ('5220','RDF COGS — Lab',                                        'EXPENSE','DEBIT','RDF',  false,false,'00000000-0000-0000-0000-000000000000'),
  ('5230','RDF COGS — Logistic',                                   'EXPENSE','DEBIT','RDF',  false,false,'00000000-0000-0000-0000-000000000000'),
  ('5310','Tax on Investment Income (20% at source)',              'EXPENSE','DEBIT','HQ',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5410','HQ Management Salaries (ED / CEO / Deputy CEO)',        'EXPENSE','DEBIT','HQ',   false,false,'00000000-0000-0000-0000-000000000000'),
  ('5420','Statutory & Compliance (VAT, Tax, Licence, Govt Fees)','EXPENSE','DEBIT', null,  false,false,'00000000-0000-0000-0000-000000000000')
on conflict (code) do nothing;
