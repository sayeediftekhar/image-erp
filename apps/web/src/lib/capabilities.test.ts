import { getEntityCapabilities, hasDeliveries } from './capabilities'

describe('getEntityCapabilities', () => {
  it('JAL: all sessions, satellite, nvd, csection', () => {
    const c = getEntityCapabilities('JAL')
    expect(c.sessions.morning).toBe(true)
    expect(c.sessions.evening).toBe(true)
    expect(c.sessions.afterhours).toBe(true)
    expect(c.satellite).toBe(true)
    expect(c.delivery.nvd).toBe(true)
    expect(c.delivery.csection).toBe(true)
  })

  it('NAS: same as JAL (csection=true)', () => {
    const c = getEntityCapabilities('NAS')
    expect(c.delivery.csection).toBe(true)
    expect(c.delivery.nvd).toBe(true)
    expect(c.satellite).toBe(true)
  })

  it('AMB: nvd but no csection', () => {
    const c = getEntityCapabilities('AMB')
    expect(c.delivery.nvd).toBe(true)
    expect(c.delivery.csection).toBe(false)
    expect(c.sessions.evening).toBe(true)
    expect(c.sessions.afterhours).toBe(true)
  })

  it('KAT: nvd, no csection, satellite (confirmed all-five-clinics)', () => {
    const c = getEntityCapabilities('KAT')
    expect(c.delivery.nvd).toBe(true)
    expect(c.delivery.csection).toBe(false)
    expect(c.satellite).toBe(true)
  })

  it('CHA: morning + satellite only — no evening, no afterhours, no delivery', () => {
    const c = getEntityCapabilities('CHA')
    expect(c.sessions.morning).toBe(true)
    expect(c.sessions.evening).toBe(false)
    expect(c.sessions.afterhours).toBe(false)
    expect(c.satellite).toBe(true)
    expect(c.delivery.nvd).toBe(false)
    expect(c.delivery.csection).toBe(false)
  })

  it('unknown code: falls back to JAL without crashing', () => {
    const c = getEntityCapabilities('ZZZZ')
    expect(c.delivery.csection).toBe(true)
    expect(c.delivery.nvd).toBe(true)
  })
})

describe('hasDeliveries', () => {
  it('JAL → true (csection)', () => {
    expect(hasDeliveries(getEntityCapabilities('JAL'))).toBe(true)
  })
  it('NAS → true (csection)', () => {
    expect(hasDeliveries(getEntityCapabilities('NAS'))).toBe(true)
  })
  it('AMB → false (nvd only, no csection → no tracked balances)', () => {
    expect(hasDeliveries(getEntityCapabilities('AMB'))).toBe(false)
  })
  it('KAT → false', () => {
    expect(hasDeliveries(getEntityCapabilities('KAT'))).toBe(false)
  })
  it('CHA → false (no delivery at all)', () => {
    expect(hasDeliveries(getEntityCapabilities('CHA'))).toBe(false)
  })
})

describe('nav derivation', () => {
  it('JAL Deliveries item is included (hasDeliveries=true)', () => {
    expect(hasDeliveries(getEntityCapabilities('JAL'))).toBe(true)
  })
  it('CHA Deliveries item is excluded (hasDeliveries=false)', () => {
    expect(hasDeliveries(getEntityCapabilities('CHA'))).toBe(false)
  })
  it('AMB Deliveries item is excluded (hasDeliveries=false)', () => {
    expect(hasDeliveries(getEntityCapabilities('AMB'))).toBe(false)
  })
})
