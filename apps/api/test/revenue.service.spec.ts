import 'reflect-metadata';
import { Pool } from 'pg';
import { LedgerService, RevenueService } from '@image-erp/posting-engine';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql:///erp_test?host=/tmp';
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';

// ── Sample draft_data ─────────────────────────────────────────────────────────

// Full JAL day — mirrors the real-data example from the task spec.
// P2-T2b: safe_delivery removed; csection income fields removed (income deferred to discharge).
// C-section advance (2000) now posts Dr 1010/PI, Cr 2150/PI — NOT income.
// Expected income (unchanged — csection values were 0 in this fixture):
//   4010 PI-Outdoor = 12550+7200+1500 = 21250
//   4040 PI-Satellite = 4100
//   4050 PI-USG = 3600+1200 = 4800
//   4020 PI-NVD = 3000
//   piCash (1010 Dr) = 21250+4100+4800+3000 = 33150
//   4110 RDF-Medicine = 8400+5600+900+2000+900 = 17800
//   4120 RDF-Lab = 3200+2100+900 = 6200
//   4130 RDF-Logistic = 300+200 = 500
//   rdfCash (1020 Dr) = 17800+6200+500 = 24500
//   totalRevenue = 33150+24500 = 57650
const JAL_FULL_DAY = {
  revenue_date: '2026-02-02',
  entity_code: 'JAL',
  channels_active: ['MORNING','EVENING','AFTERHOURS','SATELLITE','DELIVERY'],
  sessions: {
    MORNING: {
      patients_new: 1, patients_old: 78, services: 79,
      service_charge: 12550, rdf_medicine_sales: 8400,
      lab_tests: 6, lab_revenue: 3200,
      usg: [{ type: 'PP', count: 3, revenue: 3600 }],
    },
    EVENING: {
      patients_new: 0, patients_old: 45, services: 45,
      service_charge: 7200, rdf_medicine_sales: 5600,
      lab_tests: 4, lab_revenue: 2100,
      usg: [],
    },
    AFTERHOURS: {
      patients: 4, service_charge: 1500,
      rdf_medicine_sales: 900, logistic_sales: 300,
    },
  },
  satellite_teams: [
    {
      team: 'TEAM_1', patients_new: 2, patients_old: 39, services: 41,
      service_charge: 4100, rdf_medicine_sales: 2000,
      lab_tests: 2, lab_revenue: 900,
      usg: [{ type: 'PP', count: 1, revenue: 1200 }],
    },
  ],
  delivery: {
    nvd: { cases: 1, service_charge: 3000, rdf_revenue: 900, logistic_revenue: 200 },
    // C-section: advance only (income deferred to discharge).
    // No service_charge / rdf_revenue / logistic_revenue at admission.
    csection: {
      cases: 1,
      balances: [{
        receipt_no: 'RCP-001', patient_name: 'Fatema Begum',
        phone: '01700000001', advance: 2000,
        expected_balance: 3000, expected_date: '2026-02-10',
      }],
    },
  },
  other_income: [],
  financial: {
    bank_deposit: { made: true, pi_amount: 124000, rdf_amount: 0 },
    cash_advance: { amount: 0, fund: null, description: null },
    cash_in_hand_counted: 5189,
    reconciliation_notes: null,
  },
};

// Delivery-only day (no morning/evening/satellite)
const DELIVERY_ONLY_DAY = {
  revenue_date: '2026-02-03',
  entity_code: 'JAL',
  channels_active: ['DELIVERY'],
  sessions: {},
  satellite_teams: [],
  delivery: {
    nvd: { cases: 2, service_charge: 6000, rdf_revenue: 1800, logistic_revenue: 400 },
  },
  other_income: [],
  financial: {
    bank_deposit: { made: false, pi_amount: 0, rdf_amount: 0 },
    cash_advance: { amount: 0, fund: null, description: null },
    cash_in_hand_counted: 7000,
    reconciliation_notes: null,
  },
};

// Zero-income day (clinic closed / holiday)
const ZERO_DAY = {
  revenue_date: '2026-02-04',
  entity_code: 'JAL',
  channels_active: [],
  sessions: {},
  satellite_teams: [],
  delivery: {},
  other_income: [],
  financial: {
    bank_deposit: { made: false, pi_amount: 0, rdf_amount: 0 },
    cash_advance: { amount: 0, fund: null, description: null },
    cash_in_hand_counted: 0,
    reconciliation_notes: 'Holiday',
  },
};

// C-section admission day (advance only — no same-day income)
function makeCsectionAdmissionDay(revenueDate: string, advance: number, patientName = 'Test Patient') {
  return {
    revenue_date: revenueDate,
    entity_code: 'JAL',
    channels_active: ['DELIVERY'],
    sessions: {},
    satellite_teams: [],
    delivery: {
      csection: {
        cases: 1,
        balances: [{ patient_name: patientName, advance, expected_balance: 0 }],
      },
    },
    other_income: [],
    financial: {
      bank_deposit: { made: false, pi_amount: 0, rdf_amount: 0 },
      cash_advance: { amount: 0, fund: null, description: null },
      cash_in_hand_counted: advance,
      reconciliation_notes: null,
    },
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

describe('RevenueService.submitRevenueDay', () => {
  let pool: Pool;
  let ledgerService: LedgerService;
  let service: RevenueService;
  let jalEntityId: string;

  // Track revenue_day IDs created per test so afterEach can clean up
  const revenueDayIds: string[] = [];

  async function makeRevenueDayDraft(
    entityId: string,
    revenueDate: string,
    draftData: unknown,
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO public.revenue_day
         (entity_id, revenue_date, status, draft_data, created_by)
       VALUES ($1, $2, 'DRAFT', $3::jsonb, $4)
       RETURNING id`,
      [entityId, revenueDate, JSON.stringify(draftData), ACTOR_ID],
    );
    const id = rows[0].id;
    revenueDayIds.push(id);
    return id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    ledgerService = new LedgerService(pool);
    service = new RevenueService(pool, ledgerService);

    const { rows } = await pool.query(
      "SELECT id FROM public.entities WHERE code = 'JAL'",
    );
    jalEntityId = rows[0].id as string;

    // Ensure ACTOR_ID is in app_users as ADMIN (ON CONFLICT DO UPDATE so
    // subsequent Jest runs don't fail on duplicate key from prior suites)
    await pool.query(
      `INSERT INTO public.app_users (id, full_name, role, entity_id, active)
       VALUES ($1, 'Test Revenue Actor', 'ADMIN', NULL, true)
       ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', entity_id = NULL, active = true`,
      [ACTOR_ID],
    );
  });

  afterEach(async () => {
    for (const rdId of revenueDayIds) {
      // 1. For each delivery_balance: null close_entry_id, then delete DELIVERY_CLOSE JEs
      const { rows: dbRows } = await pool.query<{ id: string; close_entry_id: string | null }>(
        'SELECT id, close_entry_id FROM public.delivery_balance WHERE revenue_day_id = $1',
        [rdId],
      );
      for (const db of dbRows) {
        if (db.close_entry_id) {
          await pool.query(
            'UPDATE public.delivery_balance SET close_entry_id = NULL WHERE id = $1',
            [db.id],
          );
          await pool.query(
            "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
            [db.close_entry_id],
          );
          await pool.query('DELETE FROM public.journal_entries WHERE id = $1', [db.close_entry_id]);
        }
        // Also sweep any DELIVERY_CLOSE entries by source_id (defensive)
        const { rows: ceRows } = await pool.query<{ id: string }>(
          "SELECT id FROM public.journal_entries WHERE source_module = 'DELIVERY_CLOSE' AND source_id = $1",
          [db.id],
        );
        for (const { id: ceId } of ceRows) {
          await pool.query(
            "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
            [ceId],
          );
          await pool.query('DELETE FROM public.journal_entries WHERE id = $1', [ceId]);
        }
      }

      // 2. Delete delivery_balance (restrict FK → must go before revenue_day)
      await pool.query(
        'DELETE FROM public.delivery_balance WHERE revenue_day_id = $1',
        [rdId],
      );

      // 3. Get the income entry id (to clean it up after nulling the FK)
      const { rows } = await pool.query<{ journal_entry_id: string | null }>(
        'SELECT journal_entry_id FROM public.revenue_day WHERE id = $1',
        [rdId],
      );
      const jeId = rows[0]?.journal_entry_id ?? null;

      // 4. Null out revenue_day.journal_entry_id so we can delete it
      if (jeId) {
        await pool.query(
          'UPDATE public.revenue_day SET journal_entry_id = NULL WHERE id = $1',
          [rdId],
        );
      }

      // 5. Delete revenue_day (cascades daily_activity)
      await pool.query('DELETE FROM public.revenue_day WHERE id = $1', [rdId]);

      // 6. Clean up ALL journal entries that came from this revenue day
      //    (income + deposit + advance + csection advance — all share source_id = rdId)
      const { rows: jes } = await pool.query<{ id: string }>(
        `SELECT id FROM public.journal_entries
         WHERE source_module = 'REVENUE_ENTRY' AND source_id = $1`,
        [rdId],
      );
      for (const { id: jId } of jes) {
        await pool.query(
          "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
          [jId],
        );
        await pool.query('DELETE FROM public.journal_entries WHERE id = $1', [jId]);
      }
      if (jeId) {
        await pool.query(
          "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
          [jeId],
        );
        await pool.query('DELETE FROM public.journal_entries WHERE id = $1', [jeId]);
      }
    }
    revenueDayIds.length = 0;
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM public.app_users WHERE id = $1',
      [ACTOR_ID],
    );
    await pool.end();
  });

  // ── Test 1: Full JAL day ───────────────────────────────────────────────────
  // P2-T2b: fixture updated (safe_delivery removed, csection simplified).
  // New assertion: csection advance entry posts Dr 1010/PI=2000, Cr 2150/PI=2000.
  // Existing income assertions unchanged (csection income fields were 0 in fixture).
  it('submits a full JAL day: correct income, deposit, csection advance, stats, delivery_balance, and flips to SUBMITTED', async () => {
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-02', JAL_FULL_DAY);

    const result = await service.submitRevenueDay(rdId, ACTOR_ID);

    // Return shape
    expect(result.revenueDayId).toBe(rdId);
    expect(result.incomeEntryId).not.toBeNull();
    expect(result.totalRevenue).toBe(57650);
    expect(result.dailyActivityRows).toBeGreaterThan(0);
    expect(result.deliveryBalanceRows).toBe(1);
    // C-section advance entry posted (advance=2000)
    expect(result.csectionAdvanceEntryId).not.toBeNull();

    // revenue_day flipped
    const { rows: [rd] } = await pool.query(
      'SELECT status, journal_entry_id, total_revenue, submitted_at FROM public.revenue_day WHERE id = $1',
      [rdId],
    );
    expect(rd.status).toBe('SUBMITTED');
    expect(rd.journal_entry_id).toBe(result.incomeEntryId);
    expect(Number(rd.total_revenue)).toBe(57650);
    expect(rd.submitted_at).not.toBeNull();

    // Income entry is balanced
    const { rows: lines } = await pool.query(
      `SELECT account_code, fund, debit::numeric AS debit, credit::numeric AS credit
       FROM public.journal_lines WHERE entry_id = $1 ORDER BY account_code`,
      [result.incomeEntryId],
    );
    const totalDebit  = lines.reduce((s: number, l: any) => s + Number(l.debit),  0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(Math.round(totalDebit * 100)).toBe(Math.round(totalCredit * 100));

    // Specific income amounts
    const byCode = Object.fromEntries(
      lines.map((l: any) => [l.account_code, { debit: Number(l.debit), credit: Number(l.credit), fund: l.fund }]),
    );
    expect(byCode['1010'].debit).toBe(33150);
    expect(byCode['1020'].debit).toBe(24500);
    expect(byCode['4010'].credit).toBe(21250);
    expect(byCode['4040'].credit).toBe(4100);
    expect(byCode['4050'].credit).toBe(4800);
    expect(byCode['4020'].credit).toBe(3000);
    expect(byCode['4110'].credit).toBe(17800);
    expect(byCode['4120'].credit).toBe(6200);
    expect(byCode['4130'].credit).toBe(500);
    // No 4030 in income entry — C-section income deferred to discharge
    expect(byCode['4030']).toBeUndefined();

    // C-section advance entry: Dr 1010/PI=2000, Cr 2150/PI=2000
    const { rows: advLines } = await pool.query<{
      account_code: string; fund: string; debit: string; credit: string;
    }>(
      'SELECT account_code, fund, debit::text, credit::text FROM public.journal_lines WHERE entry_id = $1',
      [result.csectionAdvanceEntryId],
    );
    const adv = Object.fromEntries(
      advLines.map((l: any) => [l.account_code, { debit: Number(l.debit), credit: Number(l.credit), fund: l.fund }]),
    );
    expect(adv['1010'].debit).toBe(2000);
    expect(adv['1010'].fund).toBe('PI');
    expect(adv['2150'].credit).toBe(2000);
    expect(adv['2150'].fund).toBe('PI');

    // daily_activity rows exist (spot check NVD cases)
    const { rows: nvdRow } = await pool.query(
      `SELECT value FROM public.daily_activity
       WHERE entity_id = $1 AND activity_date = $2
         AND channel = 'STATIC' AND service = 'NVD' AND metric = 'cases'`,
      [jalEntityId, '2026-02-02'],
    );
    expect(Number(nvdRow[0].value)).toBe(1);

    // delivery_balance OPEN row created
    const { rows: dbs } = await pool.query(
      'SELECT patient_name, delivery_type, advance_paid, status FROM public.delivery_balance WHERE revenue_day_id = $1',
      [rdId],
    );
    expect(dbs).toHaveLength(1);
    expect(dbs[0].patient_name).toBe('Fatema Begum');
    expect(dbs[0].delivery_type).toBe('CSECTION');
    expect(Number(dbs[0].advance_paid)).toBe(2000);
    expect(dbs[0].status).toBe('OPEN');

    // Deposit entry created
    const { rows: depEntries } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.journal_entries
       WHERE source_module = 'REVENUE_ENTRY' AND source_id = $1
         AND description LIKE 'Bank deposit%'`,
      [rdId],
    );
    expect(depEntries[0].n).toBe(1);
  });

  // ── Test 2: Delivery-only day ──────────────────────────────────────────────
  it('submits a delivery-only day with no MORNING/EVENING/satellite income lines', async () => {
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-03', DELIVERY_ONLY_DAY);

    const result = await service.submitRevenueDay(rdId, ACTOR_ID);

    expect(result.totalRevenue).toBe(8200);
    expect(result.incomeEntryId).not.toBeNull();
    expect(result.deliveryBalanceRows).toBe(0);
    expect(result.csectionAdvanceEntryId).toBeNull();

    const { rows: [rd] } = await pool.query(
      'SELECT status, total_revenue FROM public.revenue_day WHERE id = $1', [rdId],
    );
    expect(rd.status).toBe('SUBMITTED');
    expect(Number(rd.total_revenue)).toBe(8200);

    const { rows: lines } = await pool.query(
      'SELECT account_code FROM public.journal_lines WHERE entry_id = $1',
      [result.incomeEntryId],
    );
    const codes = lines.map((l: any) => l.account_code);
    expect(codes).not.toContain('4010');
    expect(codes).toContain('4020');
    expect(codes).toContain('4110');
    expect(codes).toContain('4130');
  });

  // ── Test 3: Zero-income day ────────────────────────────────────────────────
  it('submits a zero-income day: no income entry posted, total_revenue=0, day flips to SUBMITTED', async () => {
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-04', ZERO_DAY);

    const result = await service.submitRevenueDay(rdId, ACTOR_ID);

    expect(result.totalRevenue).toBe(0);
    expect(result.incomeEntryId).toBeNull();
    expect(result.csectionAdvanceEntryId).toBeNull();
    expect(result.dailyActivityRows).toBe(0);
    expect(result.deliveryBalanceRows).toBe(0);

    const { rows: [rd] } = await pool.query(
      'SELECT status, journal_entry_id, total_revenue FROM public.revenue_day WHERE id = $1',
      [rdId],
    );
    expect(rd.status).toBe('SUBMITTED');
    expect(rd.journal_entry_id).toBeNull();
    expect(Number(rd.total_revenue)).toBe(0);

    const { rows: jes } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM public.journal_entries WHERE source_module = 'REVENUE_ENTRY' AND source_id = $1",
      [rdId],
    );
    expect(jes[0].n).toBe(0);
  });

  // ── Test 4: Idempotency — re-submit SUBMITTED day is rejected ─────────────
  it('rejects re-submission of a SUBMITTED day before any write (idempotency guard)', async () => {
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-05', ZERO_DAY);

    await service.submitRevenueDay(rdId, ACTOR_ID);

    await expect(service.submitRevenueDay(rdId, ACTOR_ID))
      .rejects.toThrow(/already SUBMITTED/);

    const { rows: [rd] } = await pool.query(
      'SELECT status FROM public.revenue_day WHERE id = $1', [rdId],
    );
    expect(rd.status).toBe('SUBMITTED');
  });

  // ── Test 5: Invalid draft_data → rollback, day stays DRAFT ────────────────
  it('rejects invalid draft_data (negative amount), rolls back entire txn, day stays DRAFT', async () => {
    const BAD_DRAFT = {
      ...JAL_FULL_DAY,
      revenue_date: '2026-02-06',
      sessions: {
        MORNING: {
          ...JAL_FULL_DAY.sessions.MORNING,
          service_charge: -500,
        },
      },
    };

    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-06', BAD_DRAFT);

    await expect(service.submitRevenueDay(rdId, ACTOR_ID)).rejects.toThrow();

    const { rows: [rd] } = await pool.query(
      'SELECT status FROM public.revenue_day WHERE id = $1', [rdId],
    );
    expect(rd.status).toBe('DRAFT');

    const { rows: jes } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM public.journal_entries WHERE source_module = 'REVENUE_ENTRY' AND source_id = $1",
      [rdId],
    );
    expect(jes[0].n).toBe(0);

    const { rows: das } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM public.daily_activity WHERE revenue_day_id = $1',
      [rdId],
    );
    expect(das[0].n).toBe(0);
  });

  // ── Test 6: Determinism ────────────────────────────────────────────────────
  it('same draft_data on two different days yields same total_revenue (determinism)', async () => {
    const DATA_A = { ...DELIVERY_ONLY_DAY, revenue_date: '2026-02-07' };
    const DATA_B = { ...DELIVERY_ONLY_DAY, revenue_date: '2026-02-08' };

    const rdA = await makeRevenueDayDraft(jalEntityId, '2026-02-07', DATA_A);
    const rdB = await makeRevenueDayDraft(jalEntityId, '2026-02-08', DATA_B);

    const [resultA, resultB] = await Promise.all([
      service.submitRevenueDay(rdA, ACTOR_ID),
      service.submitRevenueDay(rdB, ACTOR_ID),
    ]);

    expect(resultA.totalRevenue).toBe(resultB.totalRevenue);
    expect(resultA.dailyActivityRows).toBe(resultB.dailyActivityRows);
    expect(resultA.deliveryBalanceRows).toBe(resultB.deliveryBalanceRows);
  });

  // ── Test 7: Fund-per-line and income-entry balance ─────────────────────────
  it('income entry: PI credits carry fund=PI, RDF credits carry fund=RDF; entry is balanced', async () => {
    const DATA = {
      ...DELIVERY_ONLY_DAY,
      revenue_date: '2026-02-09',
      delivery: {
        nvd: { cases: 1, service_charge: 5000, rdf_revenue: 2000, logistic_revenue: 300 },
      },
    };
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-09', DATA);

    const result = await service.submitRevenueDay(rdId, ACTOR_ID);
    expect(result.incomeEntryId).not.toBeNull();

    const { rows: lines } = await pool.query<{
      account_code: string; fund: string; debit: string; credit: string;
    }>(
      `SELECT account_code, fund, debit::text, credit::text
       FROM public.journal_lines WHERE entry_id = $1`,
      [result.incomeEntryId],
    );

    const drPI  = lines.find((l) => l.account_code === '1010');
    expect(drPI?.fund).toBe('PI');
    expect(Number(drPI?.debit)).toBe(5000);

    const drRDF = lines.find((l) => l.account_code === '1020');
    expect(drRDF?.fund).toBe('RDF');
    expect(Number(drRDF?.debit)).toBe(2300);

    const cr4020 = lines.find((l) => l.account_code === '4020');
    expect(cr4020?.fund).toBe('PI');
    expect(Number(cr4020?.credit)).toBe(5000);

    const cr4110 = lines.find((l) => l.account_code === '4110');
    expect(cr4110?.fund).toBe('RDF');
    expect(Number(cr4110?.credit)).toBe(2000);

    const cr4130 = lines.find((l) => l.account_code === '4130');
    expect(cr4130?.fund).toBe('RDF');
    expect(Number(cr4130?.credit)).toBe(300);

    const totalDr = lines.reduce((s, l) => s + Math.round(Number(l.debit)  * 100), 0);
    const totalCr = lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
    expect(totalDr).toBe(totalCr);
    expect(totalDr).toBe(730000);
  });

  // ── Test 8: Cash advance entry posts correctly ─────────────────────────────
  it('posts a cash advance entry: Dr 1015/PI, Cr 1010/PI (default PI fund)', async () => {
    const DATA_WITH_ADVANCE = {
      ...DELIVERY_ONLY_DAY,
      revenue_date: '2026-02-10',
      financial: {
        ...DELIVERY_ONLY_DAY.financial,
        cash_advance: { amount: 1500, fund: null, description: 'Lab supplies' },
      },
    };
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-10', DATA_WITH_ADVANCE);

    const result = await service.submitRevenueDay(rdId, ACTOR_ID);
    expect(result.incomeEntryId).not.toBeNull();

    const { rows: advEntries } = await pool.query(
      `SELECT id FROM public.journal_entries
       WHERE source_module = 'REVENUE_ENTRY' AND source_id = $1
         AND description LIKE 'Cash advance%'`,
      [rdId],
    );
    expect(advEntries).toHaveLength(1);

    const { rows: advLines } = await pool.query<{
      account_code: string; fund: string; debit: string; credit: string;
    }>(
      'SELECT account_code, fund, debit::text, credit::text FROM public.journal_lines WHERE entry_id = $1',
      [advEntries[0].id],
    );
    const dr = advLines.find((l) => Number(l.debit) > 0);
    const cr = advLines.find((l) => Number(l.credit) > 0);
    expect(dr?.account_code).toBe('1015');
    expect(dr?.fund).toBe('PI');
    expect(Number(dr?.debit)).toBe(1500);
    expect(cr?.account_code).toBe('1010');
    expect(cr?.fund).toBe('PI');
    expect(Number(cr?.credit)).toBe(1500);
  });

  // ── Test 9: C-section admission — advance posts Dr 1010/PI, Cr 2150/PI ────
  // No 4030/4110/4130 income at admission; delivery_balance OPEN; income deferred.
  it('C-section admission: Dr 1010/PI=advance, Cr 2150/PI=advance; no 4030 income; delivery_balance OPEN', async () => {
    const rdId = await makeRevenueDayDraft(
      jalEntityId, '2026-02-11',
      makeCsectionAdmissionDay('2026-02-11', 3000, 'Rohima Akter'),
    );

    const result = await service.submitRevenueDay(rdId, ACTOR_ID);

    expect(result.totalRevenue).toBe(0);          // no income at admission
    expect(result.incomeEntryId).toBeNull();       // no income entry
    expect(result.csectionAdvanceEntryId).not.toBeNull();
    expect(result.deliveryBalanceRows).toBe(1);

    // Advance entry lines
    const { rows: advLines } = await pool.query<{
      account_code: string; fund: string; debit: string; credit: string;
    }>(
      'SELECT account_code, fund, debit::text, credit::text FROM public.journal_lines WHERE entry_id = $1',
      [result.csectionAdvanceEntryId],
    );
    const byCode = Object.fromEntries(
      advLines.map((l: any) => [l.account_code, { debit: Number(l.debit), credit: Number(l.credit), fund: l.fund }]),
    );
    expect(byCode['1010'].debit).toBe(3000);
    expect(byCode['1010'].fund).toBe('PI');
    expect(byCode['2150'].credit).toBe(3000);
    expect(byCode['2150'].fund).toBe('PI');

    // Balanced
    const totalDr = advLines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCr = advLines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(totalDr).toBe(totalCr);

    // No 4030/4110/4130 in any entry for this revenue day
    const { rows: allLines } = await pool.query(
      `SELECT account_code FROM public.journal_lines jl
       JOIN public.journal_entries je ON je.id = jl.entry_id
       WHERE je.source_module = 'REVENUE_ENTRY' AND je.source_id = $1`,
      [rdId],
    );
    const allCodes = allLines.map((l: any) => l.account_code);
    expect(allCodes).not.toContain('4030');
    expect(allCodes).not.toContain('4110');
    expect(allCodes).not.toContain('4130');

    // delivery_balance OPEN
    const { rows: dbs } = await pool.query(
      'SELECT patient_name, advance_paid, status FROM public.delivery_balance WHERE revenue_day_id = $1',
      [rdId],
    );
    expect(dbs).toHaveLength(1);
    expect(dbs[0].patient_name).toBe('Rohima Akter');
    expect(Number(dbs[0].advance_paid)).toBe(3000);
    expect(dbs[0].status).toBe('OPEN');
  });

  // ── Test 10: closeDeliveryBalance — normal (balance > 0) ──────────────────
  // Advance=3000, bill=5700 → balance=2700. Dr 2150=3000, Dr 1010=2700, Cr 4030=4500, Cr 4110=1000, Cr 4130=200.
  it('closeDeliveryBalance: releases 2150, posts discharge income, takes balance as cash; balanced; CLOSED', async () => {
    const rdId = await makeRevenueDayDraft(
      jalEntityId, '2026-02-12',
      makeCsectionAdmissionDay('2026-02-12', 3000, 'Nasreen Akter'),
    );
    await service.submitRevenueDay(rdId, ACTOR_ID);

    const { rows: [db] } = await pool.query(
      'SELECT id FROM public.delivery_balance WHERE revenue_day_id = $1',
      [rdId],
    );
    const dbId = db.id as string;

    const closeResult = await service.closeDeliveryBalance(
      dbId,
      { service_charge: 4000, seat_rent: 500, rdf_amount: 1000, logistics_amount: 200 },
      '2026-02-15',
      ACTOR_ID,
    );

    expect(closeResult.totalBill).toBe(5700);
    expect(closeResult.advance).toBe(3000);
    expect(closeResult.balancePaid).toBe(2700);
    expect(closeResult.closeEntryId).toBeDefined();

    // delivery_balance CLOSED
    const { rows: [dbu] } = await pool.query(
      `SELECT status, closed_date::text, final_service_charge::float,
              final_rdf_amount::float, final_logistics_amount::float,
              final_balance_paid::float, close_entry_id
       FROM public.delivery_balance WHERE id = $1`,
      [dbId],
    );
    expect(dbu.status).toBe('CLOSED');
    expect(dbu.closed_date).toBe('2026-02-15');
    expect(dbu.final_service_charge).toBe(4500);   // service_charge + seat_rent
    expect(dbu.final_rdf_amount).toBe(1000);
    expect(dbu.final_logistics_amount).toBe(200);
    expect(dbu.final_balance_paid).toBe(2700);
    expect(dbu.close_entry_id).toBe(closeResult.closeEntryId);

    // Close entry lines
    const { rows: lines } = await pool.query<{
      account_code: string; fund: string; debit: string; credit: string;
    }>(
      'SELECT account_code, fund, debit::text, credit::text FROM public.journal_lines WHERE entry_id = $1',
      [closeResult.closeEntryId],
    );
    const byCode = Object.fromEntries(
      lines.map((l: any) => [l.account_code, { debit: Number(l.debit), credit: Number(l.credit), fund: l.fund }]),
    );
    expect(byCode['2150'].debit).toBe(3000);    // advance released
    expect(byCode['2150'].fund).toBe('PI');
    expect(byCode['1010'].debit).toBe(2700);    // balance received
    expect(byCode['1010'].fund).toBe('PI');
    expect(byCode['4030'].credit).toBe(4500);   // PI service + seat rent
    expect(byCode['4030'].fund).toBe('PI');
    expect(byCode['4110'].credit).toBe(1000);   // RDF medicine
    expect(byCode['4110'].fund).toBe('RDF');
    expect(byCode['4130'].credit).toBe(200);    // RDF logistics
    expect(byCode['4130'].fund).toBe('RDF');

    // Balanced
    const totalDr = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCr = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(Math.round(totalDr * 100)).toBe(Math.round(totalCr * 100));
    expect(totalDr).toBe(5700);
  });

  // ── Test 11: closeDeliveryBalance — refund (advance > bill) ───────────────
  // Advance=5000, bill=3000 → balance=−2000 (refund). Dr 2150=5000, Cr 1010=2000, Cr 4030=3000.
  it('closeDeliveryBalance refund: advance exceeds bill, Cr 1010 for refund, 2150 fully released, balanced', async () => {
    const rdId = await makeRevenueDayDraft(
      jalEntityId, '2026-02-16',
      makeCsectionAdmissionDay('2026-02-16', 5000, 'Salma Khatun'),
    );
    await service.submitRevenueDay(rdId, ACTOR_ID);

    const { rows: [db] } = await pool.query(
      'SELECT id FROM public.delivery_balance WHERE revenue_day_id = $1', [rdId],
    );

    const closeResult = await service.closeDeliveryBalance(
      db.id,
      { service_charge: 3000, seat_rent: 0, rdf_amount: 0, logistics_amount: 0 },
      '2026-02-19',
      ACTOR_ID,
    );

    expect(closeResult.totalBill).toBe(3000);
    expect(closeResult.advance).toBe(5000);
    expect(closeResult.balancePaid).toBe(-2000); // refund

    const { rows: lines } = await pool.query<{
      account_code: string; fund: string; debit: string; credit: string;
    }>(
      'SELECT account_code, fund, debit::text, credit::text FROM public.journal_lines WHERE entry_id = $1',
      [closeResult.closeEntryId],
    );
    const byCode = Object.fromEntries(
      lines.map((l: any) => [l.account_code, { debit: Number(l.debit), credit: Number(l.credit), fund: l.fund }]),
    );
    expect(byCode['2150'].debit).toBe(5000);    // advance released in full
    expect(byCode['1010'].credit).toBe(2000);   // refund out (no Dr 1010)
    expect(byCode['1010'].debit).toBe(0);
    expect(byCode['4030'].credit).toBe(3000);
    expect(byCode['4110']).toBeUndefined();     // no RDF in bill
    expect(byCode['4130']).toBeUndefined();

    // Balanced
    const totalDr = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCr = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(Math.round(totalDr * 100)).toBe(Math.round(totalCr * 100));
    expect(totalDr).toBe(5000);
  });

  // ── Test 12: closeDeliveryBalance — exact (advance = bill) ────────────────
  // Advance=4000, bill=4000 → balance=0. No 1010 line; Dr 2150=4000, Cr 4030=4000.
  it('closeDeliveryBalance exact match: balance=0, no 1010 movement, ≥2 lines, balanced', async () => {
    const rdId = await makeRevenueDayDraft(
      jalEntityId, '2026-02-20',
      makeCsectionAdmissionDay('2026-02-20', 4000, 'Bilkis Begum'),
    );
    await service.submitRevenueDay(rdId, ACTOR_ID);

    const { rows: [db] } = await pool.query(
      'SELECT id FROM public.delivery_balance WHERE revenue_day_id = $1', [rdId],
    );

    const closeResult = await service.closeDeliveryBalance(
      db.id,
      { service_charge: 4000, seat_rent: 0, rdf_amount: 0, logistics_amount: 0 },
      '2026-02-23',
      ACTOR_ID,
    );

    expect(closeResult.balancePaid).toBe(0);

    const { rows: lines } = await pool.query<{ account_code: string; debit: string; credit: string }>(
      'SELECT account_code, debit::text, credit::text FROM public.journal_lines WHERE entry_id = $1',
      [closeResult.closeEntryId],
    );

    // No 1010 line (balance = 0 → no cash movement)
    expect(lines.find((l) => l.account_code === '1010')).toBeUndefined();
    // At least 2 lines (Dr 2150, Cr 4030)
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const totalDr = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCr = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(Math.round(totalDr * 100)).toBe(Math.round(totalCr * 100));
    expect(totalDr).toBe(4000);
  });

  // ── Test 13: closeDeliveryBalance — idempotency (CLOSED → rejected) ────────
  it('closeDeliveryBalance: closing a CLOSED balance is rejected before any write', async () => {
    const rdId = await makeRevenueDayDraft(
      jalEntityId, '2026-02-21',
      makeCsectionAdmissionDay('2026-02-21', 2000, 'Morium Khatun'),
    );
    await service.submitRevenueDay(rdId, ACTOR_ID);

    const { rows: [db] } = await pool.query(
      'SELECT id FROM public.delivery_balance WHERE revenue_day_id = $1', [rdId],
    );

    // First close succeeds
    await service.closeDeliveryBalance(
      db.id,
      { service_charge: 3500, seat_rent: 0, rdf_amount: 0, logistics_amount: 0 },
      '2026-02-24',
      ACTOR_ID,
    );

    // Second close is rejected
    await expect(
      service.closeDeliveryBalance(
        db.id,
        { service_charge: 3500, seat_rent: 0, rdf_amount: 0, logistics_amount: 0 },
        '2026-02-24',
        ACTOR_ID,
      ),
    ).rejects.toThrow(/cannot close again/);

    // delivery_balance still CLOSED, only one close entry exists
    const { rows: [dbu] } = await pool.query(
      'SELECT status FROM public.delivery_balance WHERE id = $1', [db.id],
    );
    expect(dbu.status).toBe('CLOSED');

    const { rows: ceRows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM public.journal_entries WHERE source_module = 'DELIVERY_CLOSE' AND source_id = $1",
      [db.id],
    );
    expect(ceRows[0].n).toBe(1);
  });

  // ── Test 14: Cross-day — advance on day A, discharge on day B ─────────────
  // 2150 carries the advance between days. Income lands on discharge date only.
  it('cross-day: advance posted on admission date; income (4030) on discharge date only', async () => {
    const ADMISSION_DATE  = '2026-03-01';
    const DISCHARGE_DATE  = '2026-03-04';

    const rdId = await makeRevenueDayDraft(
      jalEntityId, ADMISSION_DATE,
      makeCsectionAdmissionDay(ADMISSION_DATE, 2500, 'Amena Begum'),
    );
    await service.submitRevenueDay(rdId, ACTOR_ID);

    const { rows: [db] } = await pool.query(
      'SELECT id FROM public.delivery_balance WHERE revenue_day_id = $1', [rdId],
    );

    const closeResult = await service.closeDeliveryBalance(
      db.id,
      { service_charge: 4500, seat_rent: 500, rdf_amount: 800, logistics_amount: 0 },
      DISCHARGE_DATE,
      ACTOR_ID,
    );

    // Close entry has entry_date = discharge date
    const { rows: [je] } = await pool.query<{ entry_date: string }>(
      'SELECT entry_date::text FROM public.journal_entries WHERE id = $1',
      [closeResult.closeEntryId],
    );
    expect(je.entry_date).toBe(DISCHARGE_DATE);

    // Income accounts (4030, 4110) appear only in the close entry, not in the admission day's entries
    const { rows: admissionLines } = await pool.query(
      `SELECT account_code FROM public.journal_lines jl
       JOIN public.journal_entries je ON je.id = jl.entry_id
       WHERE je.source_module = 'REVENUE_ENTRY' AND je.source_id = $1`,
      [rdId],
    );
    const admCodes = admissionLines.map((l: any) => l.account_code);
    expect(admCodes).not.toContain('4030');
    expect(admCodes).not.toContain('4110');
    expect(admCodes).toContain('1010');   // advance cash in
    expect(admCodes).toContain('2150');   // liability created

    // Balance-by-construction: total_bill = 4500+500+800 = 5800; advance=2500; balance=3300
    expect(closeResult.totalBill).toBe(5800);
    expect(closeResult.balancePaid).toBe(3300);
  });

  // ── Test 15: Ageing flag — returns OPEN balances past N days, excludes recent ──
  // Uses getFlaggedOpenBalances(). Threshold = 4 days (delivery_balance_flag_days setting).
  // Old revenue_date='2025-01-01' → days_open >> 4 → flagged.
  // Recent revenue_date = today − 2 days → days_open = 2 < 4 → not flagged.
  // RECENT_DATE is computed dynamically so the test does not drift as calendar advances.
  it('getFlaggedOpenBalances returns balances older than flag threshold, excludes recent', async () => {
    const OLD_DATE    = '2025-01-01';
    const recentMs    = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const RECENT_DATE = new Date(recentMs).toISOString().slice(0, 10);

    const rdOld    = await makeRevenueDayDraft(
      jalEntityId, OLD_DATE,
      makeCsectionAdmissionDay(OLD_DATE, 1500, 'Old Patient'),
    );
    const rdRecent = await makeRevenueDayDraft(
      jalEntityId, RECENT_DATE,
      makeCsectionAdmissionDay(RECENT_DATE, 800, 'Recent Patient'),
    );

    await service.submitRevenueDay(rdOld, ACTOR_ID);
    await service.submitRevenueDay(rdRecent, ACTOR_ID);

    const flagged = await service.getFlaggedOpenBalances(jalEntityId);

    const names = flagged.map((f) => f.patient_name);
    expect(names).toContain('Old Patient');
    expect(names).not.toContain('Recent Patient');

    // Sanity: days_open for old patient is large
    const oldEntry = flagged.find((f) => f.patient_name === 'Old Patient');
    expect(oldEntry?.days_open).toBeGreaterThan(4);
    expect(oldEntry?.admission_date).toBe(OLD_DATE);
  });
});
