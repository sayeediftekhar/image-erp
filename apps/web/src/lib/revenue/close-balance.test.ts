import {
  computeBalanceConsequence,
  assertEntityAccess,
  EntityAccessError,
} from './close-balance'

// ── computeBalanceConsequence ─────────────────────────────────────────────────
// Mirrors the engine's balancePaid = totalBill − advance. The three boundary
// cases from §3: normal collect, overpayment/refund, exact match.

describe('computeBalanceConsequence', () => {
  test('bill > advance → collect the difference', () => {
    const r = computeBalanceConsequence(10000, 12000)
    expect(r.type).toBe('collect')
    expect(r.amount).toBe(2000)
  })

  test('bill < advance → refund the overpayment (overpayment case)', () => {
    const r = computeBalanceConsequence(10000, 8000)
    expect(r.type).toBe('refund')
    expect(r.amount).toBe(2000)
  })

  test('bill === advance → collect zero (exact match, no cash movement)', () => {
    const r = computeBalanceConsequence(10000, 10000)
    expect(r.type).toBe('collect')
    expect(r.amount).toBe(0)
  })

  test('sub-paisa diff rounds to nearest paisa (e.g. 2000.007 → 2000.01)', () => {
    // 12000.007 − 10000 = 2000.007; Math.round(2000.007 * 100) / 100 = 2000.01
    const r = computeBalanceConsequence(10000, 12000.007)
    expect(r.type).toBe('collect')
    expect(r.amount).toBe(2000.01)
  })
})

// ── assertEntityAccess (GitHub issue #6) ──────────────────────────────────────
// ENTRY may only close their own entity's balance.
// ADMIN / HQ_FINANCE bypass the entity check.

const JAL_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const NAS_ID = 'bbbbbbbb-0000-0000-0000-000000000002'

describe('assertEntityAccess', () => {
  test('ENTRY + own entity → does not throw', () => {
    expect(() => assertEntityAccess('ENTRY', JAL_ID, JAL_ID)).not.toThrow()
  })

  test('ENTRY + different entity → throws EntityAccessError 403 (issue #6)', () => {
    expect(() => assertEntityAccess('ENTRY', JAL_ID, NAS_ID))
      .toThrow(EntityAccessError)
    try {
      assertEntityAccess('ENTRY', JAL_ID, NAS_ID)
    } catch (e) {
      expect(e).toBeInstanceOf(EntityAccessError)
      expect((e as EntityAccessError).status).toBe(403)
    }
  })

  test('ADMIN + different entity → does not throw', () => {
    expect(() => assertEntityAccess('ADMIN', JAL_ID, NAS_ID)).not.toThrow()
  })

  test('HQ_FINANCE + different entity → does not throw', () => {
    expect(() => assertEntityAccess('HQ_FINANCE', JAL_ID, NAS_ID)).not.toThrow()
  })
})
