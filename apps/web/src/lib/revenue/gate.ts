import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyDays } from './classify'
import { prevMonth } from './calendar-grid'

// ── Types ─────────────────────────────────────────────────────────────────────

export type GateParams = {
  today:                  string        // YYYY-MM-DD, server-resolved (Asia/Dhaka)
  monthN:                 string        // YYYY-MM — the month being entered
  goLiveMonth:            string | null // null = gate dormant for this entity
  priorMonthMissingCount: number
  hasOverride:            boolean
  role:                   string        // from app_users
}

export type GateResult =
  | { allowed: true }
  | { allowed: false; reason: 'PRIOR_INCOMPLETE'; priorMonth: string; missingCount: number }

// ── Pure gate function (unit-testable, no I/O) ────────────────────────────────
//
// Checks in order — first matching rule wins (allowed immediately):
//
//  1. Non-ENTRY roles are never gated (ADMIN / HQ_FINANCE / READ_ONLY).
//  2. go_live_month NULL → gate dormant for this entity (safe default).
//  3. monthN < go_live_month → entering a pre-go-live month (nothing to complete).
//  4. prevMonth(monthN) < go_live_month → first-month-trap guard: prior month
//     predates go-live so it legitimately has no entries. Handles monthN ==
//     go_live_month (the very first live month) as a special case.
//  5. today ≤ 10th of monthN → grace window (first 10 days always open).
//  6. priorMonthMissingCount === 0 → prior month fully resolved.
//  7. hasOverride → admin granted a per-entity per-month pass.
//  8. → BLOCKED.

export function isEntryAllowed(p: GateParams): GateResult {
  if (p.role !== 'ENTRY') return { allowed: true }
  if (p.goLiveMonth === null) return { allowed: true }
  if (p.monthN < p.goLiveMonth) return { allowed: true }
  if (prevMonth(p.monthN) < p.goLiveMonth) return { allowed: true }
  if (p.today <= `${p.monthN}-10`) return { allowed: true }
  if (p.priorMonthMissingCount === 0) return { allowed: true }
  if (p.hasOverride) return { allowed: true }
  return {
    allowed:     false,
    reason:      'PRIOR_INCOMPLETE',
    priorMonth:  prevMonth(p.monthN),
    missingCount: p.priorMonthMissingCount,
  }
}

// ── Prior-month missing count (DB query + classifyDays) ───────────────────────
//
// Reuses classifyDays — single source of truth for MISSING classification.
// Called only when the grace-window fast path does not apply.

export async function getPriorMonthMissingCount(
  supabase:       SupabaseClient,
  entityId:       string,
  priorMonthStr:  string,   // YYYY-MM
  todayDhaka:     string,
): Promise<number> {
  const [y, m] = priorMonthStr.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const startDate   = `${priorMonthStr}-01`
  const endDate     = `${priorMonthStr}-${String(daysInMonth).padStart(2, '0')}`

  const { data: rows } = await supabase
    .from('revenue_day')
    .select('id, revenue_date, status, total_revenue')
    .eq('entity_id', entityId)
    .gte('revenue_date', startDate)
    .lte('revenue_date', endDate)

  const days = classifyDays(rows ?? [], todayDhaka, y, m)
  return days.filter(d => d.state === 'MISSING').length
}

// ── Async gate check (grace-window fast path + DB queries) ────────────────────
//
// Called at three server-side enforcement points:
//   1. wizard/page.tsx  — prevents rendering the wizard for a gated day
//   2. save-draft route — rejects DRAFT saves for a gated month
//   3. submit-day route — rejects submits for a gated month (backstop)
//
// Fast path: if today ≤ 10th of monthN, returns allowed immediately (0 queries).
// After that: 1 query for go_live_month + 1 query for override + 1 query for
// prior-month rows (→ classifyDays). Three queries total on the slow path.
//
// todayDhaka MUST come from getDhakaToday() — never a client-supplied value.

export async function checkGateForMonth(
  supabase:   SupabaseClient,
  entityId:   string,
  monthN:     string,   // YYYY-MM
  todayDhaka: string,   // server-resolved, Asia/Dhaka
  role:       string,
): Promise<GateResult> {
  // Non-ENTRY roles are never gated — skip all queries
  if (role !== 'ENTRY') return { allowed: true }

  // Grace-window fast path: no queries needed
  if (todayDhaka <= `${monthN}-10`) return { allowed: true }

  // Fetch go_live_month (1 query)
  const { data: entity } = await supabase
    .from('entities')
    .select('go_live_month')
    .eq('id', entityId)
    .single()

  const goLiveMonth: string | null = (entity as { go_live_month?: string | null } | null)
    ?.go_live_month ?? null

  if (goLiveMonth === null) return { allowed: true }
  if (monthN < goLiveMonth) return { allowed: true }
  if (prevMonth(monthN) < goLiveMonth) return { allowed: true }

  // Fetch override row for this entity+month (1 query)
  const { data: override } = await supabase
    .from('month_gate_override')
    .select('id')
    .eq('entity_id', entityId)
    .eq('gated_month', monthN)
    .maybeSingle()

  const hasOverride = override !== null
  if (hasOverride) return { allowed: true }

  // Compute prior month missing count (1 DB fetch)
  const priorMonthStr    = prevMonth(monthN)
  const priorMissingCount = await getPriorMonthMissingCount(
    supabase, entityId, priorMonthStr, todayDhaka,
  )

  return isEntryAllowed({
    today:                  todayDhaka,
    monthN,
    goLiveMonth,
    priorMonthMissingCount: priorMissingCount,
    hasOverride,
    role,
  })
}
