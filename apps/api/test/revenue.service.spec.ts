import 'reflect-metadata';
import { Pool } from 'pg';
import { LedgerService } from '../src/ledger/ledger.service';
import { RevenueService } from '../src/revenue/revenue.service';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql:///erp_test?host=/tmp';
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';

// ── Sample draft_data ─────────────────────────────────────────────────────────

// Full JAL day — mirrors the real-data example from the task spec.
// Expected income:
//   4010 PI-Outdoor = 12550+7200+1500 = 21250
//   4040 PI-Satellite = 4100
//   4050 PI-USG = 3600+1200 = 4800
//   4020 PI-NVD = 3000
//   4030 PI-C-Section = 0 (skipped)
//   4090 PI-Other = 0 (skipped)
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
    csection: {
      cases: 0, service_charge: 0, rdf_revenue: 0, logistic_revenue: 0,
      balances: [{
        receipt_no: 'RCP-001', patient_name: 'Fatema Begum',
        phone: '01700000001', advance: 2000, expected_balance: 3000,
        expected_date: '2026-02-10',
      }],
    },
    safe_delivery: { rdf_revenue: 0, logistic_revenue: 0, balances: [] },
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
      // 1. Delete delivery_balance (restrict FK → must go first)
      await pool.query(
        'DELETE FROM public.delivery_balance WHERE revenue_day_id = $1',
        [rdId],
      );

      // 2. Get the income entry id (to clean it up after nulling the FK)
      const { rows } = await pool.query<{ journal_entry_id: string | null }>(
        'SELECT journal_entry_id FROM public.revenue_day WHERE id = $1',
        [rdId],
      );
      const jeId = rows[0]?.journal_entry_id ?? null;

      // 3. Null out revenue_day.journal_entry_id so we can delete it
      if (jeId) {
        await pool.query(
          'UPDATE public.revenue_day SET journal_entry_id = NULL WHERE id = $1',
          [rdId],
        );
      }

      // 4. Delete revenue_day (cascades daily_activity)
      await pool.query('DELETE FROM public.revenue_day WHERE id = $1', [rdId]);

      // 5. Clean up ALL journal entries that came from this revenue day
      //    (income + deposit + advance — all share source_id = rdId)
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
      // Also delete the income entry fetched earlier (may not have source_id if null)
      if (jeId) {
        await pool.query(
          "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
          [jeId],
        );
        await pool.query(
          'DELETE FROM public.journal_entries WHERE id = $1',
          [jeId],
        );
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
  it('submits a full JAL day: correct income, deposit, stats, delivery_balance, and flips to SUBMITTED', async () => {
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-02', JAL_FULL_DAY);

    const result = await service.submitRevenueDay(rdId, ACTOR_ID);

    // Return shape
    expect(result.revenueDayId).toBe(rdId);
    expect(result.incomeEntryId).not.toBeNull();
    expect(result.totalRevenue).toBe(57650);
    expect(result.dailyActivityRows).toBeGreaterThan(0);
    expect(result.deliveryBalanceRows).toBe(1);

    // revenue_day flipped
    const { rows: [rd] } = await pool.query(
      'SELECT status, journal_entry_id, total_revenue, submitted_at FROM public.revenue_day WHERE id = $1',
      [rdId],
    );
    expect(rd.status).toBe('SUBMITTED');
    expect(rd.journal_entry_id).toBe(result.incomeEntryId);
    expect(Number(rd.total_revenue)).toBe(57650);
    expect(rd.submitted_at).not.toBeNull();

    // Income entry exists and is balanced (engine's DB trigger confirms at COMMIT)
    const { rows: lines } = await pool.query(
      `SELECT account_code, fund, debit::numeric AS debit, credit::numeric AS credit
       FROM public.journal_lines WHERE entry_id = $1 ORDER BY account_code`,
      [result.incomeEntryId],
    );
    const totalDebit  = lines.reduce((s: number, l: any) => s + Number(l.debit),  0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(Math.round(totalDebit * 100)).toBe(Math.round(totalCredit * 100)); // balanced

    // Specific amounts
    const byCode = Object.fromEntries(
      lines.map((l: any) => [l.account_code, { debit: Number(l.debit), credit: Number(l.credit), fund: l.fund }]),
    );
    expect(byCode['1010'].debit).toBe(33150);   // PI cash debit
    expect(byCode['1020'].debit).toBe(24500);   // RDF cash debit
    expect(byCode['4010'].credit).toBe(21250);  // PI-Outdoor
    expect(byCode['4040'].credit).toBe(4100);   // PI-Satellite
    expect(byCode['4050'].credit).toBe(4800);   // PI-USG
    expect(byCode['4020'].credit).toBe(3000);   // PI-NVD
    expect(byCode['4110'].credit).toBe(17800);  // RDF-Medicine
    expect(byCode['4120'].credit).toBe(6200);   // RDF-Lab
    expect(byCode['4130'].credit).toBe(500);    // RDF-Logistic

    // daily_activity rows exist (spot check NVD cases)
    const { rows: nvdRow } = await pool.query(
      `SELECT value FROM public.daily_activity
       WHERE entity_id = $1 AND activity_date = $2
         AND channel = 'STATIC' AND service = 'NVD' AND metric = 'cases'`,
      [jalEntityId, '2026-02-02'],
    );
    expect(Number(nvdRow[0].value)).toBe(1);

    // delivery_balance row created
    const { rows: dbs } = await pool.query(
      'SELECT patient_name, delivery_type, advance_paid, status FROM public.delivery_balance WHERE revenue_day_id = $1',
      [rdId],
    );
    expect(dbs).toHaveLength(1);
    expect(dbs[0].patient_name).toBe('Fatema Begum');
    expect(dbs[0].delivery_type).toBe('CSECTION');
    expect(Number(dbs[0].advance_paid)).toBe(2000);
    expect(dbs[0].status).toBe('OPEN');

    // Deposit entry created (bank_deposit.made=true, pi_amount=124000)
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

    // totalRevenue = PI(nvd.service_charge=6000) + RDF(nvd.rdf=1800 + nvd.logistic=400) = 6000+2200=8200
    expect(result.totalRevenue).toBe(8200);
    expect(result.incomeEntryId).not.toBeNull();
    expect(result.deliveryBalanceRows).toBe(0);

    const { rows: [rd] } = await pool.query(
      'SELECT status, total_revenue FROM public.revenue_day WHERE id = $1', [rdId],
    );
    expect(rd.status).toBe('SUBMITTED');
    expect(Number(rd.total_revenue)).toBe(8200);

    // No MORNING/EVENING lines in the income entry
    const { rows: lines } = await pool.query(
      'SELECT account_code FROM public.journal_lines WHERE entry_id = $1',
      [result.incomeEntryId],
    );
    const codes = lines.map((l: any) => l.account_code);
    expect(codes).not.toContain('4010'); // PI-Outdoor (no sessions)
    expect(codes).toContain('4020');     // PI-NVD
    expect(codes).toContain('4110');     // RDF-Medicine (nvd.rdf_revenue)
    expect(codes).toContain('4130');     // RDF-Logistic
  });

  // ── Test 3: Zero-income day ────────────────────────────────────────────────
  it('submits a zero-income day: no income entry posted, total_revenue=0, day flips to SUBMITTED', async () => {
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-04', ZERO_DAY);

    const result = await service.submitRevenueDay(rdId, ACTOR_ID);

    expect(result.totalRevenue).toBe(0);
    expect(result.incomeEntryId).toBeNull();
    expect(result.dailyActivityRows).toBe(0);
    expect(result.deliveryBalanceRows).toBe(0);

    const { rows: [rd] } = await pool.query(
      'SELECT status, journal_entry_id, total_revenue FROM public.revenue_day WHERE id = $1',
      [rdId],
    );
    expect(rd.status).toBe('SUBMITTED');
    expect(rd.journal_entry_id).toBeNull();
    expect(Number(rd.total_revenue)).toBe(0);

    // No journal entries created
    const { rows: jes } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM public.journal_entries WHERE source_module = 'REVENUE_ENTRY' AND source_id = $1",
      [rdId],
    );
    expect(jes[0].n).toBe(0);
  });

  // ── Test 4: Idempotency — re-submit SUBMITTED day is rejected ─────────────
  it('rejects re-submission of a SUBMITTED day before any write (idempotency guard)', async () => {
    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-05', ZERO_DAY);

    // First submit succeeds
    await service.submitRevenueDay(rdId, ACTOR_ID);

    // Second submit is rejected
    await expect(service.submitRevenueDay(rdId, ACTOR_ID))
      .rejects.toThrow(/already SUBMITTED/);

    // Day is still SUBMITTED (not reverted)
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
          service_charge: -500, // negative → Zod rejects
        },
      },
    };

    const rdId = await makeRevenueDayDraft(jalEntityId, '2026-02-06', BAD_DRAFT);

    await expect(service.submitRevenueDay(rdId, ACTOR_ID)).rejects.toThrow();

    // Day still DRAFT — nothing was committed
    const { rows: [rd] } = await pool.query(
      'SELECT status FROM public.revenue_day WHERE id = $1', [rdId],
    );
    expect(rd.status).toBe('DRAFT');

    // No journal entries or daily_activity rows
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
    // PI cash: 5000, RDF cash: 2000+300=2300
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

    // 1010 Dr line → fund=PI
    const drPI  = lines.find((l) => l.account_code === '1010');
    expect(drPI?.fund).toBe('PI');
    expect(Number(drPI?.debit)).toBe(5000);

    // 1020 Dr line → fund=RDF
    const drRDF = lines.find((l) => l.account_code === '1020');
    expect(drRDF?.fund).toBe('RDF');
    expect(Number(drRDF?.debit)).toBe(2300);

    // 4020 (PI-NVD) credit → fund=PI
    const cr4020 = lines.find((l) => l.account_code === '4020');
    expect(cr4020?.fund).toBe('PI');
    expect(Number(cr4020?.credit)).toBe(5000);

    // 4110 (RDF-Medicine) credit → fund=RDF
    const cr4110 = lines.find((l) => l.account_code === '4110');
    expect(cr4110?.fund).toBe('RDF');
    expect(Number(cr4110?.credit)).toBe(2000);

    // 4130 (RDF-Logistic) credit → fund=RDF
    const cr4130 = lines.find((l) => l.account_code === '4130');
    expect(cr4130?.fund).toBe('RDF');
    expect(Number(cr4130?.credit)).toBe(300);

    // Balanced
    const totalDr = lines.reduce((s, l) => s + Math.round(Number(l.debit)  * 100), 0);
    const totalCr = lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
    expect(totalDr).toBe(totalCr);
    expect(totalDr).toBe(730000); // 7300 Taka × 100 paisa
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

    // Advance entry exists
    const { rows: advEntries } = await pool.query(
      `SELECT id FROM public.journal_entries
       WHERE source_module = 'REVENUE_ENTRY' AND source_id = $1
         AND description LIKE 'Cash advance%'`,
      [rdId],
    );
    expect(advEntries).toHaveLength(1);

    // Advance entry lines: Dr 1015/PI, Cr 1010/PI
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
});
