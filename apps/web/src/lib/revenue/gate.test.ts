import { isEntryAllowed } from './gate'
import type { GateParams } from './gate'

// Baseline "all checks would block" params — override specific fields per test.
const BLOCKED_BASE: GateParams = {
  role:                   'ENTRY',
  today:                  '2026-06-15',
  monthN:                 '2026-06',
  goLiveMonth:            '2026-05',   // go-live was May; June is the 2nd live month
  priorMonthMissingCount: 3,
  hasOverride:            false,
}

describe('isEntryAllowed — 12-branch coverage', () => {

  // ── Role exemptions ──────────────────────────────────────────────────────────

  test('1. ADMIN role → allowed (never gated)', () => {
    expect(isEntryAllowed({ ...BLOCKED_BASE, role: 'ADMIN' }))
      .toEqual({ allowed: true })
  })

  test('2. HQ_FINANCE role → allowed (never gated)', () => {
    expect(isEntryAllowed({ ...BLOCKED_BASE, role: 'HQ_FINANCE' }))
      .toEqual({ allowed: true })
  })

  // ── go_live_month null ────────────────────────────────────────────────────────

  test('3. go_live_month null → allowed (gate dormant — safe default)', () => {
    expect(isEntryAllowed({ ...BLOCKED_BASE, goLiveMonth: null }))
      .toEqual({ allowed: true })
  })

  // ── Grace window ──────────────────────────────────────────────────────────────

  test('4. today = 3rd of monthN → allowed (grace window: 3rd ≤ 10th)', () => {
    expect(isEntryAllowed({ ...BLOCKED_BASE, today: '2026-06-03' }))
      .toEqual({ allowed: true })
  })

  test('5. today = exactly 10th of monthN → allowed (grace boundary: ≤ 10th)', () => {
    expect(isEntryAllowed({ ...BLOCKED_BASE, today: '2026-06-10' }))
      .toEqual({ allowed: true })
  })

  // ── Pre-go-live ───────────────────────────────────────────────────────────────

  test('6. monthN < go_live_month → allowed (entering a pre-go-live month)', () => {
    // go_live_month='2026-07': June is before July, so June is pre-go-live
    expect(isEntryAllowed({ ...BLOCKED_BASE, goLiveMonth: '2026-07', monthN: '2026-06' }))
      .toEqual({ allowed: true })
  })

  // ── Correction 1: First-month-trap guard ─────────────────────────────────────
  // prevMonth(monthN) < go_live_month → prior month predates go-live, nothing to
  // complete. Handles the first live month (monthN == go_live_month) and the general
  // case where prevMonth is still before go-live.

  test('7. monthN == go_live_month → allowed (first-month-trap guard: prevMonth predates go-live)', () => {
    // go_live_month='2026-07': July is the first live month.
    // prevMonth('2026-07') = '2026-06' < '2026-07' → allowed (nothing to complete in June)
    expect(isEntryAllowed({
      ...BLOCKED_BASE,
      goLiveMonth:            '2026-07',
      monthN:                 '2026-07',
      today:                  '2026-07-15',  // past the 10th
      priorMonthMissingCount: 30,            // June is entirely missing — would block if not guarded
      hasOverride:            false,
    })).toEqual({ allowed: true })
  })

  test('12. go_live_month == monthN (equal, not strictly less) → Correction 1 still allows', () => {
    // Confirms rule 4 (prevMonth < goLiveMonth) fires when monthN == goLiveMonth.
    // goLiveMonth='2026-06', monthN='2026-06' → prevMonth='2026-05' < '2026-06' → allowed.
    expect(isEntryAllowed({
      ...BLOCKED_BASE,
      goLiveMonth:            '2026-06',
      monthN:                 '2026-06',
      today:                  '2026-06-15',
      priorMonthMissingCount: 15,
      hasOverride:            false,
    })).toEqual({ allowed: true })
  })

  // ── Prior complete ────────────────────────────────────────────────────────────

  test('8. priorMonthMissingCount = 0 → allowed (prior month fully resolved)', () => {
    expect(isEntryAllowed({ ...BLOCKED_BASE, priorMonthMissingCount: 0 }))
      .toEqual({ allowed: true })
  })

  // ── Override ──────────────────────────────────────────────────────────────────

  test('10. hasOverride = true → allowed (admin granted a pass)', () => {
    expect(isEntryAllowed({ ...BLOCKED_BASE, hasOverride: true }))
      .toEqual({ allowed: true })
  })

  // ── BLOCKED ───────────────────────────────────────────────────────────────────

  test('9. today > 10th, prior missing > 0, no override → BLOCKED with priorMonth + missingCount', () => {
    const result = isEntryAllowed(BLOCKED_BASE)   // today='2026-06-15', priorMissing=3, no override
    expect(result).toEqual({
      allowed:     false,
      reason:      'PRIOR_INCOMPLETE',
      priorMonth:  '2026-05',
      missingCount: 3,
    })
  })

  test('11. year boundary BLOCKED: monthN=2026-01, priorMonth=2025-12 (correct year rollover)', () => {
    // go_live_month='2025-11': November 2025 was go-live.
    // prevMonth('2026-01') = '2025-12'. Is '2025-12' < '2025-11'? No → proceeds to checks.
    // today='2026-01-15' > '2026-01-10', priorMissing=2, no override → BLOCKED.
    const result = isEntryAllowed({
      ...BLOCKED_BASE,
      goLiveMonth:            '2025-11',
      monthN:                 '2026-01',
      today:                  '2026-01-15',
      priorMonthMissingCount: 2,
      hasOverride:            false,
    })
    expect(result).toEqual({
      allowed:     false,
      reason:      'PRIOR_INCOMPLETE',
      priorMonth:  '2025-12',
      missingCount: 2,
    })
  })

})
