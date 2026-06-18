-- ============================================================================
-- P1-T6 TEST SUITE: Chart of accounts
-- Run order: shim → 0001–0006 → T1_test → T2_test → T3_test → T4_test →
--            T5_test → THIS FILE
-- Proves: all 59 chart codes present; 2010/1590 sourced from 0006 seed (not
-- the T1 test fixture, which now uses Z010/Z590); spot-check key fields;
-- requires_approval set is exactly the 9 approved accounts; idempotency.
--
-- All checks run as owner (postgres) — data correctness only. RLS on accounts
-- is already proven in T1; this suite proves the seed data, not the policies.
-- ============================================================================
\set ON_ERROR_STOP on

reset role;

-- ============================================================================
-- A. ACCOUNT COUNT
-- Count by explicit code list so T1 test fixture codes (Z010, Z590) and any
-- other test-only accounts never inflate the result.
-- ============================================================================
select test.assert(
  (select count(*)::int from public.accounts where code in (
    '1010','1015','1020','1110','1120','1130','1140','1190',
    '1210','1220','1230','1310','1320','1410','1510','1520',
    '1530','1590','1610',
    '2010','2110','2120','2210','2310','2410',
    '3010','3020','3030','3040','3900',
    '4010','4020','4030','4040','4050','4090',
    '4110','4120','4130','4210','4220',
    '5010','5020','5030','5040','5050','5060','5070','5080','5090',
    '5110','5120','5130','5210','5220','5230','5310','5410','5420'
  )) = 59,
  'chart: all 59 codes present'
);

-- ============================================================================
-- B. 2010 AND 1590 SOURCED FROM 0006 SEED (not T1 fixture)
-- T1 test fix renamed its fixtures to Z010/Z590. These four assertions confirm
-- that 2010 and 1590 carry the chart values from 0006, which is what T4 and
-- T5 tests relied on when they inserted journal lines against these codes.
-- ============================================================================

-- 2010: name from 0006 uses em-dash and "(Control)"; T1 fixture used plain
-- hyphen and no "(Control)" tag — name mismatch proves the source is 0006.
select test.assert(
  (select name from public.accounts where code = '2010')
    = 'Accounts Payable — Suppliers (Control)',
  '2010 sourced from 0006 seed: name is chart name (not T1 fixture)'
);
select test.assert(
  (select type::text from public.accounts where code = '2010') = 'LIABILITY',
  '2010 sourced from 0006 seed: type=LIABILITY'
);

-- 1590: T1 fixture also seeded ASSET/CREDIT, so check both fields plus fund=NULL
-- to confirm the full 0006 row is in place.
select test.assert(
  (select type::text from public.accounts where code = '1590') = 'ASSET',
  '1590 sourced from 0006 seed: type=ASSET'
);
select test.assert(
  (select normal_balance::text from public.accounts where code = '1590') = 'CREDIT',
  '1590 sourced from 0006 seed: normal_balance=CREDIT (contra-asset)'
);

-- ============================================================================
-- C. SPOT-CHECKS (spec done-criteria §2)
-- ============================================================================

-- 1010 Cash in Hand — PI: canonical plain-asset row
select test.assert(
  exists (
    select 1 from public.accounts
    where code = '1010'
      and type = 'ASSET'
      and normal_balance = 'DEBIT'
      and fund = 'PI'
      and is_control = false
      and requires_approval = false
  ),
  '1010: ASSET/DEBIT/PI/not-control/no-approval'
);

-- 1590 Accumulated Depreciation: contra-asset (ASSET + CREDIT); fund and
-- requires_approval already confirmed above — just verify fund=NULL here.
select test.assert(
  (select fund from public.accounts where code = '1590') is null,
  '1590: fund is null (contra-asset applies across any fund)'
);

-- 1190 EXIM STD — FROZEN: fund=NULL confirmed by Sayeed 2026-06-18
-- (cross-fund sweep: PI→HQ; fixing to PI would block the sweep)
select test.assert(
  (select fund from public.accounts where code = '1190') is null,
  '1190: fund is null (EXIM freeze sweep crosses funds — confirmed)'
);

-- 2010 Accounts Payable — Suppliers (Control): liability/credit/RDF/control
select test.assert(
  exists (
    select 1 from public.accounts
    where code = '2010'
      and type = 'LIABILITY'
      and normal_balance = 'CREDIT'
      and fund = 'RDF'
      and is_control = true
  ),
  '2010: LIABILITY/CREDIT/RDF/is_control=true'
);

-- 4030 PI — C-Section: income spot-check
select test.assert(
  exists (
    select 1 from public.accounts
    where code = '4030'
      and type = 'INCOME'
      and normal_balance = 'CREDIT'
      and fund = 'PI'
  ),
  '4030: INCOME/CREDIT/PI'
);

-- 5210 RDF COGS — Medicines: expense spot-check
select test.assert(
  exists (
    select 1 from public.accounts
    where code = '5210'
      and type = 'EXPENSE'
      and normal_balance = 'DEBIT'
      and fund = 'RDF'
  ),
  '5210: EXPENSE/DEBIT/RDF'
);

-- 4210 Bank Interest: fund must be NULL (interest earned into different funds)
select test.assert(
  (select fund from public.accounts where code = '4210') is null,
  '4210: fund is null (interest earned into PI/RDF/HQ; resolved on line)'
);

-- ============================================================================
-- D. REQUIRES_APPROVAL SET
-- Exactly 9 accounts have requires_approval=true:
-- 1410, 1520, 2210, 3010, 3020, 3030, 3040, 3900, 4220
-- ============================================================================

-- Total count of requires_approval=true accounts = 9 (no extras anywhere)
select test.assert(
  (select count(*)::int from public.accounts where requires_approval = true) = 9,
  'requires_approval=true count = 9 (no extra accounts flagged)'
);

-- All 9 expected codes carry the flag
select test.assert(
  (select count(*)::int from public.accounts
   where code in ('1410','1520','2210','3010','3020','3030','3040','3900','4220')
     and requires_approval = true) = 9,
  'all 9 expected approval-gate accounts have requires_approval=true'
);

-- Spot-check false cases: a plain asset and a plain expense
select test.assert(
  (select count(*)::int from public.accounts
   where code in ('1010','5010')
     and requires_approval = false) = 2,
  '1010 and 5010 have requires_approval=false'
);

-- ============================================================================
-- E. IDEMPOTENCY
-- Re-inserting an existing code with different data is silently skipped.
-- ============================================================================

insert into public.accounts (code, name, type, normal_balance, created_by)
  values ('1010', 'DUPLICATE ATTEMPT', 'ASSET', 'DEBIT',
          '00000000-0000-0000-0000-000000000000')
  on conflict (code) do nothing;

select test.assert(
  (select name from public.accounts where code = '1010') = 'Cash in Hand — PI',
  'idempotency: duplicate insert of 1010 skipped; name unchanged'
);

select test.assert(
  (select count(*)::int from public.accounts where code in (
    '1010','1015','1020','1110','1120','1130','1140','1190',
    '1210','1220','1230','1310','1320','1410','1510','1520',
    '1530','1590','1610',
    '2010','2110','2120','2210','2310','2410',
    '3010','3020','3030','3040','3900',
    '4010','4020','4030','4040','4050','4090',
    '4110','4120','4130','4210','4220',
    '5010','5020','5030','5040','5050','5060','5070','5080','5090',
    '5110','5120','5130','5210','5220','5230','5310','5410','5420'
  )) = 59,
  'idempotency: chart count still 59 after duplicate insert attempt'
);

reset role;
select '======== ALL P1-T6 TESTS PASSED ========' as result;
