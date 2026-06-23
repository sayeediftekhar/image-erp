import { stripInactiveChannels } from './strip-inactive'

const FULL_DRAFT = {
  channels_active: ['MORNING', 'EVENING', 'AFTERHOURS', 'SATELLITE', 'DELIVERY'],
  sessions: {
    MORNING:    { service_charge: 1000, rdf_medicine_sales: 0, lab_revenue: 0, usg: [] },
    EVENING:    { service_charge: 500,  rdf_medicine_sales: 0, lab_revenue: 0, usg: [] },
    AFTERHOURS: { service_charge: 200,  rdf_medicine_sales: 0, logistic_sales: 0 },
  },
  satellite_teams: [
    { team: 'TEAM_1', service_charge: 300, rdf_medicine_sales: 0, lab_revenue: 0, usg: [] },
  ],
  delivery: {
    nvd:      { cases: 1, service_charge: 400, rdf_revenue: 0, logistic_revenue: 0 },
    csection: { cases: 1, balances: [{ patient_name: 'Fatema', advance: 5000 }] },
  },
  revenue_date: '2020-03-01',
  entity_code:  'JAL',
}

describe('stripInactiveChannels', () => {
  it('no-op when all channels are active', () => {
    const result = stripInactiveChannels(FULL_DRAFT as Record<string, unknown>)
    const sessions = result.sessions as Record<string, unknown>
    expect(sessions.MORNING).toBeDefined()
    expect(sessions.EVENING).toBeDefined()
    expect(sessions.AFTERHOURS).toBeDefined()
    expect((result.satellite_teams as unknown[]).length).toBe(1)
    const delivery = result.delivery as Record<string, unknown>
    expect(delivery.nvd).toBeDefined()
    expect(delivery.csection).toBeDefined()
  })

  it('strips sessions.MORNING when MORNING not in channels_active', () => {
    const draft = { ...FULL_DRAFT, channels_active: ['EVENING', 'AFTERHOURS', 'SATELLITE', 'DELIVERY'] }
    const result = stripInactiveChannels(draft as Record<string, unknown>)
    const sessions = result.sessions as Record<string, unknown>
    expect(sessions.MORNING).toBeUndefined()
    expect(sessions.EVENING).toBeDefined()
    expect(sessions.AFTERHOURS).toBeDefined()
  })

  it('strips sessions.EVENING when not active', () => {
    const draft = { ...FULL_DRAFT, channels_active: ['MORNING', 'SATELLITE'] }
    const result = stripInactiveChannels(draft as Record<string, unknown>)
    const sessions = result.sessions as Record<string, unknown>
    expect(sessions.EVENING).toBeUndefined()
    expect(sessions.MORNING).toBeDefined()
  })

  it('strips sessions.AFTERHOURS when not active', () => {
    const draft = { ...FULL_DRAFT, channels_active: ['MORNING', 'SATELLITE'] }
    const result = stripInactiveChannels(draft as Record<string, unknown>)
    expect((result.sessions as Record<string, unknown>).AFTERHOURS).toBeUndefined()
  })

  it('clears satellite_teams when SATELLITE not in channels_active', () => {
    const draft = { ...FULL_DRAFT, channels_active: ['MORNING', 'DELIVERY'] }
    const result = stripInactiveChannels(draft as Record<string, unknown>)
    expect(result.satellite_teams as unknown[]).toHaveLength(0)
  })

  it('removes delivery when DELIVERY not in channels_active', () => {
    const draft = { ...FULL_DRAFT, channels_active: ['MORNING', 'SATELLITE'] }
    const result = stripInactiveChannels(draft as Record<string, unknown>)
    const delivery = result.delivery as Record<string, unknown>
    expect(delivery.nvd).toBeUndefined()
    expect(delivery.csection).toBeUndefined()
    expect(Object.keys(delivery)).toHaveLength(0)
  })

  it('preserves channels_active and other top-level keys', () => {
    const result = stripInactiveChannels(FULL_DRAFT as Record<string, unknown>)
    expect(result.channels_active).toEqual(FULL_DRAFT.channels_active)
    expect(result.revenue_date).toBe('2020-03-01')
    expect(result.entity_code).toBe('JAL')
  })

  it('does not mutate the original draft object', () => {
    const draft = { ...FULL_DRAFT, channels_active: ['MORNING'] } as Record<string, unknown>
    const before = JSON.stringify(draft)
    stripInactiveChannels(draft)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('handles empty channels_active — strips everything', () => {
    const draft = { ...FULL_DRAFT, channels_active: [] }
    const result = stripInactiveChannels(draft as Record<string, unknown>)
    const sessions = result.sessions as Record<string, unknown>
    expect(sessions.MORNING).toBeUndefined()
    expect(sessions.EVENING).toBeUndefined()
    expect(sessions.AFTERHOURS).toBeUndefined()
    expect(result.satellite_teams as unknown[]).toHaveLength(0)
    expect(Object.keys(result.delivery as object)).toHaveLength(0)
  })
})
