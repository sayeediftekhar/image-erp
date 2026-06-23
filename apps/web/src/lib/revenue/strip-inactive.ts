// Strips draft_data slices for channels not present in channels_active.
// Called client-side in the submit handler before the final save-draft call,
// so the engine reads the already-stripped draft from DB.
// The engine (submitRevenueDay) does NOT filter by channels_active — a
// deselected channel's lingering slice would post if not stripped here.
export function stripInactiveChannels(draft: Record<string, unknown>): Record<string, unknown> {
  const active: string[] = Array.isArray(draft.channels_active)
    ? (draft.channels_active as string[])
    : []

  const rawSessions = (draft.sessions as Record<string, unknown> | undefined) ?? {}
  const sessions: Record<string, unknown> = {}
  for (const key of ['MORNING', 'EVENING', 'AFTERHOURS']) {
    if (active.includes(key) && rawSessions[key] !== undefined) {
      sessions[key] = rawSessions[key]
    }
  }

  const satelliteTeams = active.includes('SATELLITE') ? (draft.satellite_teams ?? []) : []

  const delivery: Record<string, unknown> = active.includes('DELIVERY')
    ? ((draft.delivery as Record<string, unknown> | undefined) ?? {})
    : {}

  return { ...draft, sessions, satellite_teams: satelliteTeams, delivery }
}
