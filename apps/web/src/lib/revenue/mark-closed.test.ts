import { Pool } from 'pg';
import { markClosedDay, MarkClosedError } from './mark-closed';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql:///erp_test?host=/tmp';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';

// Use dates far in the past so tests don't conflict with real manager entries.
const DATE_A = '2020-01-10'; // missing day
const DATE_B = '2020-01-11'; // re-close attempt (Test E equivalent)
const DATE_C = '2020-01-12'; // empty DRAFT → close
const DATE_D = '2020-01-13'; // DRAFT with real data → reject

describe('markClosedDay', () => {
  let pool: Pool;
  let jalEntityId: string;
  const revenueDayIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });

    const { rows } = await pool.query(
      "SELECT id FROM public.entities WHERE code = 'JAL'",
    );
    jalEntityId = rows[0].id as string;

    // Seed test actor as ENTRY for JAL (ON CONFLICT so re-runs don't fail)
    await pool.query(
      `INSERT INTO public.app_users (id, full_name, role, entity_id, active)
       VALUES ($1, 'Mark-Closed Test Actor', 'ENTRY', $2, true)
       ON CONFLICT (id) DO UPDATE SET role = 'ENTRY', entity_id = $2, active = true`,
      [ACTOR_ID, jalEntityId],
    );
  });

  afterEach(async () => {
    if (revenueDayIds.length === 0) return;
    // Zero-days post no journal entries — direct DELETE suffices.
    await pool.query(
      'DELETE FROM public.revenue_day WHERE id = ANY($1)',
      [revenueDayIds],
    );
    revenueDayIds.length = 0;
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM public.app_users WHERE id = $1',
      [ACTOR_ID],
    );
    await pool.end();
  });

  // ── Helper: insert a DRAFT row directly ────────────────────────────────────

  async function insertDraft(date: string, draftData: unknown): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO public.revenue_day
         (entity_id, revenue_date, status, draft_data, created_by)
       VALUES ($1, $2, 'DRAFT', $3::jsonb, $4)
       RETURNING id`,
      [jalEntityId, date, JSON.stringify(draftData), ACTOR_ID],
    );
    revenueDayIds.push(rows[0].id);
    return rows[0].id;
  }

  // ── Test A: Missing day → closed successfully ─────────────────────────────

  it('A — missing day creates a SUBMITTED zero-day (total=0, no journal entry)', async () => {
    const { revenueDayId } = await markClosedDay(pool, ACTOR_ID, jalEntityId, DATE_A);
    revenueDayIds.push(revenueDayId);

    const { rows } = await pool.query<{
      status: string; total_revenue: string; journal_entry_id: string | null;
    }>(
      'SELECT status, total_revenue::text, journal_entry_id FROM public.revenue_day WHERE id = $1',
      [revenueDayId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('SUBMITTED');
    expect(Number(rows[0].total_revenue)).toBe(0);
    expect(rows[0].journal_entry_id).toBeNull();
  });

  // ── Test E (spec): re-close SUBMITTED day → 409, draft_data byte-unchanged ─

  it('E — re-close SUBMITTED day → MarkClosedError ALREADY_SUBMITTED, draft_data byte-unchanged', async () => {
    // Setup: close the day first
    const { revenueDayId } = await markClosedDay(pool, ACTOR_ID, jalEntityId, DATE_B);
    revenueDayIds.push(revenueDayId);

    // Capture draft_data BEFORE the second attempt
    const { rows: before } = await pool.query<{ draft_data: unknown }>(
      'SELECT draft_data FROM public.revenue_day WHERE id = $1',
      [revenueDayId],
    );
    const draftDataBefore = JSON.stringify(before[0].draft_data);

    // Second mark-closed attempt
    await expect(
      markClosedDay(pool, ACTOR_ID, jalEntityId, DATE_B),
    ).rejects.toMatchObject({
      name: 'MarkClosedError',
      code: 'ALREADY_SUBMITTED',
    });

    // Assert draft_data is byte-unchanged
    const { rows: after } = await pool.query<{ draft_data: unknown }>(
      'SELECT draft_data FROM public.revenue_day WHERE id = $1',
      [revenueDayId],
    );
    expect(JSON.stringify(after[0].draft_data)).toBe(draftDataBefore);
  });

  // ── Test C: empty DRAFT row → submits cleanly ─────────────────────────────

  it('C — DRAFT row with empty draft_data → SUBMITTED zero-day', async () => {
    // Insert a zero draft_data DRAFT row (as if a prior mark-closed attempt created it but crashed)
    const emptyDraft = {
      revenue_date: DATE_C,
      entity_code: 'JAL',
      financial: { bank_deposit: { made: false }, cash_advance: {}, cash_in_hand_counted: 0 },
    };
    await insertDraft(DATE_C, emptyDraft);

    const { revenueDayId } = await markClosedDay(pool, ACTOR_ID, jalEntityId, DATE_C);
    // id is the same one we inserted (mark-closed reuses it)
    revenueDayIds.push(revenueDayId);

    const { rows } = await pool.query<{ status: string; total_revenue: string }>(
      'SELECT status, total_revenue::text FROM public.revenue_day WHERE id = $1',
      [revenueDayId],
    );
    expect(rows[0].status).toBe('SUBMITTED');
    expect(Number(rows[0].total_revenue)).toBe(0);
  });

  // ── Test D: DRAFT with non-empty data → rejected, row unchanged ───────────
  // This is the "non-negotiable" test from the task brief.

  it('D — DRAFT with real entered data → MarkClosedError HAS_DRAFT_DATA, row byte-unchanged', async () => {
    const realDraft = {
      revenue_date: DATE_D,
      entity_code: 'JAL',
      channels_active: ['MORNING'],
      sessions: {
        MORNING: {
          patients_new: 5, patients_old: 20, services: 25,
          service_charge: 5000, rdf_medicine_sales: 1500,
          lab_tests: 3, lab_revenue: 900,
          usg: [],
        },
      },
      satellite_teams: [],
      delivery: {},
      other_income: [],
      financial: {
        bank_deposit: { made: false, pi_amount: 0, rdf_amount: 0 },
        cash_advance: { amount: 0, fund: null, description: null },
        cash_in_hand_counted: 5000,
        reconciliation_notes: null,
      },
    };
    const existingId = await insertDraft(DATE_D, realDraft);

    // Capture draft_data BEFORE the attempt
    const { rows: before } = await pool.query<{ draft_data: unknown }>(
      'SELECT draft_data FROM public.revenue_day WHERE id = $1',
      [existingId],
    );
    const draftDataBefore = JSON.stringify(before[0].draft_data);

    // Attempt to mark-close → must be rejected
    await expect(
      markClosedDay(pool, ACTOR_ID, jalEntityId, DATE_D),
    ).rejects.toMatchObject({
      name: 'MarkClosedError',
      code: 'HAS_DRAFT_DATA',
    });

    // Verify: row is still DRAFT and draft_data is byte-unchanged
    const { rows: after } = await pool.query<{ status: string; draft_data: unknown }>(
      'SELECT status, draft_data FROM public.revenue_day WHERE id = $1',
      [existingId],
    );
    expect(after[0].status).toBe('DRAFT');
    expect(JSON.stringify(after[0].draft_data)).toBe(draftDataBefore);
  });
});
