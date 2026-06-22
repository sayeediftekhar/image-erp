import { mergeSliceIntoDraft, mergeTeamStubs } from './draft-merge'

// ── mergeSliceIntoDraft ───────────────────────────────────────────────────────

const BASE = {
  revenue_date:    '2025-01-15',
  entity_code:     'JAL',
  channels_active: ['MORNING', 'EVENING'],
  sessions:        { MORNING: { patients_new: 5, service_charge: 1000, usg: [] } },
  satellite_teams: [] as unknown[],
}

describe('mergeSliceIntoDraft', () => {
  it('MORNING: sets sessions.MORNING, leaves other top-level keys untouched', () => {
    const slice = { patients_new: 10, patients_old: 2, services: 12, service_charge: 1500, rdf_medicine_sales: 300, lab_tests: 2, lab_revenue: 400, usg: [] }
    const result = mergeSliceIntoDraft(BASE, 'MORNING', slice)
    expect((result.sessions as Record<string, unknown>).MORNING).toEqual(slice)
    expect(result.channels_active).toEqual(['MORNING', 'EVENING'])
    expect(result.revenue_date).toBe('2025-01-15')
  })

  it('EVENING: sets sessions.EVENING alongside existing sessions.MORNING', () => {
    const slice = { patients_new: 3, patients_old: 40, services: 43, service_charge: 7000, rdf_medicine_sales: 500, lab_tests: 4, lab_revenue: 600, usg: [] }
    const result = mergeSliceIntoDraft(BASE, 'EVENING', slice)
    const sessions = result.sessions as Record<string, unknown>
    expect(sessions.EVENING).toEqual(slice)
    expect(sessions.MORNING).toEqual({ patients_new: 5, service_charge: 1000, usg: [] }) // preserved
  })

  it('AFTERHOURS: sets sessions.AFTERHOURS', () => {
    const slice = { patients: 8, service_charge: 300, rdf_medicine_sales: 100, logistic_sales: 50 }
    const result = mergeSliceIntoDraft(BASE, 'AFTERHOURS', slice)
    expect((result.sessions as Record<string, unknown>).AFTERHOURS).toEqual(slice)
  })

  it('SATELLITE_TEAM_1: sets satellite_teams[0]', () => {
    const draft = { ...BASE, satellite_teams: [] }
    const slice = { team: 'TEAM_1', patients_new: 7, patients_old: 3, services: 10, service_charge: 400, rdf_medicine_sales: 80, lab_tests: 1, lab_revenue: 150, usg: [] }
    const result = mergeSliceIntoDraft(draft, 'SATELLITE_TEAM_1', slice)
    expect((result.satellite_teams as unknown[])[0]).toEqual(slice)
  })

  it('SATELLITE_TEAM_2: sets satellite_teams[1], preserves satellite_teams[0]', () => {
    const team1 = { team: 'TEAM_1', patients_new: 7, patients_old: 3, services: 10, service_charge: 400, rdf_medicine_sales: 80, lab_tests: 1, lab_revenue: 150, usg: [] }
    const draft = { ...BASE, satellite_teams: [team1] }
    const slice2 = { team: 'TEAM_2', patients_new: 4, patients_old: 1, services: 5, service_charge: 250, rdf_medicine_sales: 50, lab_tests: 0, lab_revenue: 0, usg: [] }
    const result = mergeSliceIntoDraft(draft, 'SATELLITE_TEAM_2', slice2)
    const teams = result.satellite_teams as unknown[]
    expect(teams[0]).toEqual(team1)   // TEAM_1 preserved
    expect(teams[1]).toEqual(slice2)
  })

  it('unknown step ID (e.g. DELIVERY): returns original object unchanged', () => {
    const slice = { nvd: { cases: 1 } }
    const result = mergeSliceIntoDraft(BASE, 'DELIVERY', slice)
    expect(result).toEqual(BASE)
  })

  it('channel deselect: spreading draftData preserves sessions.MORNING when channels_active excludes it', () => {
    const existingDraft = {
      revenue_date:    '2025-01-15',
      entity_code:     'JAL',
      channels_active: ['MORNING', 'SATELLITE'],
      sessions:        { MORNING: { patients_new: 5, service_charge: 1000, usg: [] } },
      satellite_teams: [{ team: 'TEAM_1', patients_new: 0, service_charge: 0, usg: [] }],
    }
    // Simulate WizardClient's handleSaveStep1 spreading draftData with MORNING deselected.
    // channels_active is authoritative for T3d posting; the lingering sessions.MORNING is harmless.
    const step1Resave = {
      ...existingDraft,
      channels_active: ['SATELLITE'],  // MORNING removed
    }
    expect(step1Resave.channels_active).not.toContain('MORNING')
    expect((step1Resave.sessions as Record<string, unknown>).MORNING).toBeDefined()
    expect(((step1Resave.sessions as Record<string, unknown>).MORNING as Record<string, unknown>).patients_new).toBe(5)
  })
})

// ── mergeTeamStubs ────────────────────────────────────────────────────────────

const TEAM1 = { team: 'TEAM_1', patients_new: 10, patients_old: 5, services: 15, service_charge: 1000, rdf_medicine_sales: 200, lab_tests: 3, lab_revenue: 300, usg: [] }
const TEAM2 = { team: 'TEAM_2', patients_new: 7,  patients_old: 3, services: 10, service_charge: 700,  rdf_medicine_sales: 150, lab_tests: 2, lab_revenue: 200, usg: [] }
const TEAM3 = { team: 'TEAM_3', patients_new: 5,  patients_old: 2, services: 7,  service_charge: 500,  rdf_medicine_sales: 100, lab_tests: 1, lab_revenue: 100, usg: [] }

describe('mergeTeamStubs', () => {
  it('growing 2→3: preserves TEAM_1+TEAM_2, appends an empty TEAM_3 stub', () => {
    const result = mergeTeamStubs([TEAM1, TEAM2], 3)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(TEAM1)
    expect(result[1]).toEqual(TEAM2)
    expect(result[2].team).toBe('TEAM_3')
    expect(result[2].patients_new).toBe(0)
    expect(result[2].service_charge).toBe(0)
    expect(result[2].usg).toEqual([])
  })

  it('shrinking 3→2: preserves TEAM_1+TEAM_2, drops TEAM_3', () => {
    const result = mergeTeamStubs([TEAM1, TEAM2, TEAM3], 2)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(TEAM1)
    expect(result[1]).toEqual(TEAM2)
  })

  it('same count (2→2): all existing teams preserved', () => {
    const result = mergeTeamStubs([TEAM1, TEAM2], 2)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(TEAM1)
    expect(result[1]).toEqual(TEAM2)
  })

  it('empty existing + count=2: creates 2 default stubs with correct team tokens', () => {
    const result = mergeTeamStubs([], 2)
    expect(result).toHaveLength(2)
    expect(result[0].team).toBe('TEAM_1')
    expect(result[1].team).toBe('TEAM_2')
    expect(result[0].patients_new).toBe(0)
    expect(result[1].service_charge).toBe(0)
  })
})
