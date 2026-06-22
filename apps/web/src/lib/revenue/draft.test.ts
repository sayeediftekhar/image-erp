import { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { saveDraftDay, DraftSaveError } from './save-draft'

// Integration tests for saveDraftDay (real DB, pool). No FK on created_by — any UUID is fine.
const DB_URL = process.env.DATABASE_URL ?? 'postgresql:///erp_test?host=/tmp'

// Date unlikely to collide with real revenue data
const TEST_DATE = '2020-01-15'

describe('saveDraftDay (integration)', () => {
  let pool: Pool
  let jalId: string
  const actorId = randomUUID()

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM public.entities WHERE code = 'JAL'",
    )
    jalId = rows[0].id
    expect(jalId).toBeDefined()
  })

  afterEach(async () => {
    // Clean up test rows regardless of test outcome
    await pool.query(
      'DELETE FROM public.revenue_day WHERE entity_id = $1 AND revenue_date = $2',
      [jalId, TEST_DATE],
    )
  })

  afterAll(async () => {
    await pool.end()
  })

  it('creates a DRAFT row for a missing day (isNew=true)', async () => {
    const partial = { revenue_date: TEST_DATE, entity_code: 'JAL', channels_active: ['MORNING'] }
    const result = await saveDraftDay(pool, actorId, jalId, TEST_DATE, partial)

    expect(result.revenueDayId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.isNew).toBe(true)

    const { rows } = await pool.query<{ status: string; draft_data: { channels_active: string[] } }>(
      'SELECT status, draft_data FROM public.revenue_day WHERE id = $1',
      [result.revenueDayId],
    )
    expect(rows[0].status).toBe('DRAFT')
    expect(rows[0].draft_data.channels_active).toEqual(['MORNING'])
  })

  it('upserts on second save — same revenueDayId, isNew=false, draft_data updated', async () => {
    const first = await saveDraftDay(
      pool, actorId, jalId, TEST_DATE,
      { revenue_date: TEST_DATE, entity_code: 'JAL', channels_active: ['MORNING'] },
    )

    const second = await saveDraftDay(
      pool, actorId, jalId, TEST_DATE,
      { revenue_date: TEST_DATE, entity_code: 'JAL', channels_active: ['MORNING', 'SATELLITE'] },
    )

    expect(second.revenueDayId).toBe(first.revenueDayId)
    expect(second.isNew).toBe(false)

    const { rows } = await pool.query<{ draft_data: { channels_active: string[] } }>(
      'SELECT draft_data FROM public.revenue_day WHERE id = $1',
      [first.revenueDayId],
    )
    expect(rows[0].draft_data.channels_active).toEqual(['MORNING', 'SATELLITE'])
  })

  it('round-trip: satellite_teams stubs written and readable back', async () => {
    const partial = {
      revenue_date:    TEST_DATE,
      entity_code:     'JAL',
      channels_active: ['MORNING', 'SATELLITE'],
      satellite_teams: [
        { team: 'TEAM_1', patients_new: 0, patients_old: 0, services: 0, service_charge: 0, rdf_medicine_sales: 0, lab_tests: 0, lab_revenue: 0, usg: [] },
        { team: 'TEAM_2', patients_new: 0, patients_old: 0, services: 0, service_charge: 0, rdf_medicine_sales: 0, lab_tests: 0, lab_revenue: 0, usg: [] },
      ],
    }
    const { revenueDayId } = await saveDraftDay(pool, actorId, jalId, TEST_DATE, partial)

    const { rows } = await pool.query<{ draft_data: typeof partial }>(
      'SELECT draft_data FROM public.revenue_day WHERE id = $1',
      [revenueDayId],
    )
    expect(rows[0].draft_data.channels_active).toEqual(['MORNING', 'SATELLITE'])
    expect(rows[0].draft_data.satellite_teams).toHaveLength(2)
    expect(rows[0].draft_data.satellite_teams[0].team).toBe('TEAM_1')
    expect(rows[0].draft_data.satellite_teams[1].team).toBe('TEAM_2')
  })

  it('throws DraftSaveError ALREADY_SUBMITTED when day is submitted', async () => {
    // Create a DRAFT row then flip it to SUBMITTED via pool (BYPASSRLS)
    const { revenueDayId } = await saveDraftDay(
      pool, actorId, jalId, TEST_DATE,
      { revenue_date: TEST_DATE, entity_code: 'JAL', channels_active: [] },
    )
    await pool.query(
      "UPDATE public.revenue_day SET status = 'SUBMITTED' WHERE id = $1",
      [revenueDayId],
    )

    await expect(
      saveDraftDay(pool, actorId, jalId, TEST_DATE, { channels_active: ['MORNING'] }),
    ).rejects.toMatchObject({ name: 'DraftSaveError', code: 'ALREADY_SUBMITTED' })
  })

  it('throws DraftSaveError ENTITY_NOT_FOUND for a non-existent entity — no raw Postgres error', async () => {
    const fakeEntityId = randomUUID()  // valid UUID format, but no entities row
    await expect(
      saveDraftDay(pool, actorId, fakeEntityId, TEST_DATE, { revenue_date: TEST_DATE, entity_code: 'FAKE' }),
    ).rejects.toMatchObject({ name: 'DraftSaveError', code: 'ENTITY_NOT_FOUND' })
  })

  it('posts nothing to journal_entries (Iron Law 2)', async () => {
    const { rows: before } = await pool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM public.journal_entries',
    )
    await saveDraftDay(
      pool, actorId, jalId, TEST_DATE,
      { revenue_date: TEST_DATE, entity_code: 'JAL', channels_active: ['MORNING', 'SATELLITE'] },
    )
    const { rows: after } = await pool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM public.journal_entries',
    )
    expect(after[0].n).toBe(before[0].n)
  })
})
