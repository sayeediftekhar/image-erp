// ── Types ─────────────────────────────────────────────────────────────────────

export interface UsgEntry {
  type: 'LOWER' | 'WHOLE' | 'PP' | 'ANOMALY'
  count: number
  revenue: number
}

interface TeamStub {
  team: string
  patients_new: number
  patients_old: number
  services: number
  service_charge: number
  rdf_medicine_sales: number
  lab_tests: number
  lab_revenue: number
  usg: UsgEntry[]
}

// ── USG ───────────────────────────────────────────────────────────────────────

// Only entries with count > 0 or revenue > 0 are persisted. Empty rows are
// dropped so the stored array reflects what the session actually recorded.
export function filterUsgEntries(entries: UsgEntry[]): UsgEntry[] {
  return entries.filter(e => e.count > 0 || e.revenue > 0)
}

// ── Satellite team stubs ──────────────────────────────────────────────────────

function defaultTeamStub(n: number): TeamStub {
  return {
    team: `TEAM_${n}`,
    patients_new: 0, patients_old: 0, services: 0,
    service_charge: 0, rdf_medicine_sales: 0,
    lab_tests: 0, lab_revenue: 0, usg: [],
  }
}

// Merges existing filled team data with a new count.
// Growing: new indices get empty stubs. Shrinking: trailing teams are dropped.
// A manager who bumps 2→3 keeps their two filled teams; the new TEAM_3 is empty.
export function mergeTeamStubs(existing: unknown[], newCount: number): TeamStub[] {
  const typed = existing as TeamStub[]
  return Array.from({ length: newCount }, (_, i) => typed[i] ?? defaultTeamStub(i + 1))
}

// ── Draft slice merge ─────────────────────────────────────────────────────────

// Merges a step's saved slice into the accumulated draftData object.
// sessions.* for deselected channels are NOT cleared here — channels_active is
// the authority for T3d posting; lingering slices are harmless and must be
// preserved so a fat-finger toggle deselect doesn't destroy entered data.
export function mergeSliceIntoDraft(
  current: Record<string, unknown>,
  stepId: string,
  slice: unknown,
): Record<string, unknown> {
  if (stepId === 'MORNING' || stepId === 'EVENING' || stepId === 'AFTERHOURS') {
    return {
      ...current,
      sessions: {
        ...(current.sessions as Record<string, unknown> ?? {}),
        [stepId]: slice,
      },
    }
  }
  const teamMatch = stepId.match(/^SATELLITE_TEAM_(\d+)$/)
  if (teamMatch) {
    const teamIndex = parseInt(teamMatch[1], 10) - 1
    const teams = Array.isArray(current.satellite_teams)
      ? [...(current.satellite_teams as unknown[])]
      : []
    teams[teamIndex] = slice
    return { ...current, satellite_teams: teams }
  }
  if (stepId === 'DELIVERY') {
    return { ...current, delivery: slice }
  }
  if (stepId === 'FINANCIAL') {
    return { ...current, financial: slice }
  }
  return current
}
