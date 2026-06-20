import 'reflect-metadata';
import { Pool } from 'pg';
import { LedgerService } from '../src/ledger/ledger.service';
import { RevenueService } from '../src/revenue/revenue.service';

// Connects to erp_test via Unix socket (same as the Jest suite).
// Override with DATABASE_URL env var if your socket path differs.
const DB_URL = process.env.DATABASE_URL ?? 'postgresql:///erp_test?host=/tmp';
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';

// NOTE: data is NOT cleaned up after the run so you can inspect DB state.
// If you need to re-run, first delete the revenue_day row for 2026-06-15 / JAL
// (cascades will remove the journal entries and delivery_balance via FK triggers).

describe('P2-T2b one-off verification', () => {
  let pool: Pool;
  let service: RevenueService;
  let jalEntityId: string;
  let rdId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    const ledger = new LedgerService(pool);
    service = new RevenueService(pool, ledger);

    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM public.entities WHERE code = 'JAL'",
    );
    if (!rows[0]) throw new Error('JAL entity not found — run migrations first');
    jalEntityId = rows[0].id;

    // Upsert actor so the actor-guard never fires regardless of prior DB state.
    await pool.query(
      `INSERT INTO public.app_users (id, full_name, role, entity_id, active)
       VALUES ($1, 'Verify Script Actor', 'ADMIN', NULL, true)
       ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', entity_id = NULL, active = true`,
      [ACTOR_ID],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('C-section admission → submit → close', async () => {
    // ── 1. Insert DRAFT revenue_day ───────────────────────────────────────────
    const draftData = {
      revenue_date:    '2026-06-15',
      entity_code:     'JAL',
      channels_active: ['DELIVERY'],
      sessions:        {},
      satellite_teams: [],
      delivery: {
        csection: {
          cases:    1,
          balances: [{
            receipt_no:       'RCP-VERIFY-001',
            patient_name:     'Verify Patient',
            phone:            '01711000000',
            advance:          2000,
            expected_balance: 5000,
            expected_date:    '2026-06-18',
          }],
        },
      },
      other_income: [],
      financial: {
        bank_deposit:         { made: false, pi_amount: 0, rdf_amount: 0 },
        cash_advance:         { amount: 0, fund: null, description: null },
        cash_in_hand_counted: 2000,
        reconciliation_notes: null,
      },
    };

    const { rows: [{ id }] } = await pool.query<{ id: string }>(
      `INSERT INTO public.revenue_day
         (entity_id, revenue_date, status, draft_data, created_by)
       VALUES ($1, '2026-06-15', 'DRAFT', $2::jsonb, $3)
       RETURNING id`,
      [jalEntityId, JSON.stringify(draftData), ACTOR_ID],
    );
    rdId = id;
    console.log('\n══ revenue_day inserted:', rdId);

    // ── 2. submitRevenueDay ───────────────────────────────────────────────────
    const submitResult = await service.submitRevenueDay(rdId, ACTOR_ID);
    console.log('\n══ SubmitResult:');
    console.log(JSON.stringify(submitResult, null, 2));

    expect(submitResult.incomeEntryId).toBeNull();
    expect(submitResult.csectionAdvanceEntryId).not.toBeNull();
    expect(submitResult.deliveryBalanceRows).toBe(1);

    // ── 3. Inspect OPEN delivery_balance ──────────────────────────────────────
    const { rows: [db] } = await pool.query<{
      id: string; patient_name: string; advance_paid: string; status: string;
    }>(
      `SELECT id, patient_name, advance_paid::text, status
       FROM public.delivery_balance WHERE revenue_day_id = $1`,
      [rdId],
    );
    console.log('\n══ delivery_balance (OPEN):');
    console.log(JSON.stringify(db, null, 2));
    expect(db.status).toBe('OPEN');

    // ── 4. closeDeliveryBalance ───────────────────────────────────────────────
    // bill4030 = service_charge(4000) + seat_rent(1000) = 5000  → 4030/PI
    // bill4110 = rdf_amount(1500)                               → 4110/RDF
    // bill4130 = logistics_amount(500)                          → 4130/RDF
    // totalBill = 7000;  advance = 2000;  balancePaid = 5000
    // Dr 2150/PI=2000  Dr 1010/PI=5000  Cr 4030/PI=5000  Cr 4110/RDF=1500  Cr 4130/RDF=500
    const closeResult = await service.closeDeliveryBalance(
      db.id,
      { service_charge: 4000, seat_rent: 1000, rdf_amount: 1500, logistics_amount: 500 },
      '2026-06-18',
      ACTOR_ID,
    );
    console.log('\n══ CloseResult:');
    console.log(JSON.stringify(closeResult, null, 2));

    expect(closeResult.totalBill).toBe(7000);
    expect(closeResult.advance).toBe(2000);
    expect(closeResult.balancePaid).toBe(5000);
    expect(closeResult.closeEntryId).toBeTruthy();

    // ── 5. Inspect CLOSED delivery_balance ────────────────────────────────────
    const { rows: [dbu] } = await pool.query<Record<string, unknown>>(
      `SELECT
         status,
         closed_date::text,
         final_service_charge::float,
         final_rdf_amount::float,
         final_logistics_amount::float,
         final_balance_paid::float,
         close_entry_id::text
       FROM public.delivery_balance WHERE id = $1`,
      [db.id],
    );
    console.log('\n══ delivery_balance (CLOSED):');
    console.log(JSON.stringify(dbu, null, 2));
    expect(dbu.status).toBe('CLOSED');

    // ── 6. Inspect close-entry lines ─────────────────────────────────────────
    const { rows: lines } = await pool.query<Record<string, unknown>>(
      `SELECT jl.account_code, jl.fund, jl.debit::float, jl.credit::float
       FROM public.journal_lines jl
       WHERE jl.journal_entry_id = $1
       ORDER BY jl.debit DESC, jl.account_code`,
      [closeResult.closeEntryId],
    );
    console.log('\n══ Close-entry lines (expected: Dr2150=2000 Dr1010=5000 Cr4030=5000 Cr4110=1500 Cr4130=500):');
    console.log(JSON.stringify(lines, null, 2));

    console.log('\n══ IDs for manual inspection:');
    console.log('   revenue_day      :', rdId);
    console.log('   delivery_balance :', db.id);
    console.log('   advance entry    :', submitResult.csectionAdvanceEntryId);
    console.log('   close  entry     :', closeResult.closeEntryId);
  }, 30000);
});
