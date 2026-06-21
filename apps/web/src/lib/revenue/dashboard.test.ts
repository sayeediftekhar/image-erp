import { Pool } from 'pg'
import { LedgerService, RevenueService } from '@image-erp/posting-engine'

// Integration smoke tests for the dashboard data layer (web pool → posting-engine).
// Full getFlaggedOpenBalances entity isolation is tested in apps/api/test/revenue.service.spec.ts.
// These tests verify the web layer wiring: pool singleton → service instantiation → DB call.

const DB_URL = process.env.DATABASE_URL ?? 'postgresql:///erp_test?host=/tmp'

describe('dashboard data layer', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: DB_URL })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('getFlaggedOpenBalances: web pool → RevenueService → returns array without error', async () => {
    const { rows } = await pool.query("SELECT id FROM public.entities WHERE code = 'JAL'")
    const jalId = rows[0]?.id as string
    expect(jalId).toBeDefined()

    const ledger  = new LedgerService(pool)
    const revenue = new RevenueService(pool, ledger)
    const balances = await revenue.getFlaggedOpenBalances(jalId)

    expect(Array.isArray(balances)).toBe(true)
  })

  it('entity isolation invariant: every returned row belongs to the queried entity', async () => {
    const { rows: entRows } = await pool.query(
      "SELECT id, code FROM public.entities WHERE code IN ('JAL', 'NAS')"
    )
    const jalId = (entRows as { id: string; code: string }[]).find(r => r.code === 'JAL')?.id
    const nasId = (entRows as { id: string; code: string }[]).find(r => r.code === 'NAS')?.id
    expect(jalId).toBeDefined()
    expect(nasId).toBeDefined()

    const ledger  = new LedgerService(pool)
    const revenue = new RevenueService(pool, ledger)

    const jalRows = await revenue.getFlaggedOpenBalances(jalId)
    const nasRows = await revenue.getFlaggedOpenBalances(nasId)

    for (const b of jalRows) expect(b.entity_id).toBe(jalId)
    for (const b of nasRows) expect(b.entity_id).toBe(nasId)
  })

  it('classifyDays reuse: import works and returns DayViewModel array', async () => {
    const { classifyDays, getDhakaToday } = await import('../revenue/classify')
    const today = getDhakaToday()
    const [y, m] = today.split('-').map(Number)
    const days = classifyDays([], today, y, m)
    expect(Array.isArray(days)).toBe(true)
    for (const d of days) {
      expect(['MISSING', 'DRAFT', 'ENTERED', 'CLOSED']).toContain(d.state)
    }
  })
})
