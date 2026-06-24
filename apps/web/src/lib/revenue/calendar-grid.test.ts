import {
  buildCalendarGrid,
  tapRoute,
  prevMonth,
  nextMonth,
  monthLabel,
  todayMonth,
} from './calendar-grid'
import type { DayViewModel } from './classify'

// ── buildCalendarGrid ─────────────────────────────────────────────────────────

describe('buildCalendarGrid — cell count', () => {
  test('Feb 2026 (28 days): exactly 28 non-null cells', () => {
    const grid = buildCalendarGrid(2026, 2, '2026-02-28', [])
    expect(grid.flat().filter(c => c !== null)).toHaveLength(28)
  })

  test('June 2026 (30 days): exactly 30 non-null cells', () => {
    const grid = buildCalendarGrid(2026, 6, '2026-06-30', [])
    expect(grid.flat().filter(c => c !== null)).toHaveLength(30)
  })

  test('all weeks have exactly 7 cells (trailing padding fills last week)', () => {
    for (const [y, m] of [[2026, 1], [2026, 4], [2026, 6], [2026, 2]]) {
      const grid = buildCalendarGrid(y, m, '2099-12-31', [])
      for (const week of grid) {
        expect(week).toHaveLength(7)
      }
    }
  })
})

describe('buildCalendarGrid — Sunday-first leading padding', () => {
  // Feb 1, 2026 = Sunday → getDay() = 0 → 0 leading nulls
  test('Feb 2026 day 1 (Sunday): no leading padding, day 1 is in column 0', () => {
    const grid = buildCalendarGrid(2026, 2, '2026-02-28', [])
    expect(grid[0][0]).not.toBeNull()
    expect(grid[0][0]?.date).toBe('2026-02-01')
  })

  // May 1, 2026 = Friday → getDay() = 5 → 5 leading null cells
  test('May 2026 day 1 (Friday): 5 leading null cells, day 1 is in column 5', () => {
    const grid = buildCalendarGrid(2026, 5, '2026-05-31', [])
    const flat = grid.flat()
    for (let i = 0; i < 5; i++) expect(flat[i]).toBeNull()
    expect(flat[5]).not.toBeNull()
    expect(flat[5]?.date).toBe('2026-05-01')
  })

  // June 1, 2026 = Monday → getDay() = 1 → 1 leading null cell
  test('June 2026 day 1 (Monday): 1 leading null cell, day 1 is in column 1', () => {
    const grid = buildCalendarGrid(2026, 6, '2026-06-30', [])
    const flat = grid.flat()
    expect(flat[0]).toBeNull()
    expect(flat[1]).not.toBeNull()
    expect(flat[1]?.date).toBe('2026-06-01')
  })
})

describe('buildCalendarGrid — state derivation', () => {
  test('days > todayDhaka → FUTURE', () => {
    const grid = buildCalendarGrid(2026, 6, '2026-06-15', [])
    const flat = grid.flat()
    expect(flat.find(c => c?.date === '2026-06-16')?.state).toBe('FUTURE')
    expect(flat.find(c => c?.date === '2026-06-30')?.state).toBe('FUTURE')
  })

  test('past days not in input rows → MISSING', () => {
    const grid = buildCalendarGrid(2026, 6, '2026-06-24', [])
    const flat = grid.flat()
    expect(flat.find(c => c?.date === '2026-06-01')?.state).toBe('MISSING')
    expect(flat.find(c => c?.date === '2026-06-10')?.state).toBe('MISSING')
  })

  test('todayDhaka itself (not in rows) → MISSING (not FUTURE)', () => {
    // date > todayDhaka is false when equal, so today with no row → MISSING
    const grid = buildCalendarGrid(2026, 6, '2026-06-24', [])
    expect(grid.flat().find(c => c?.date === '2026-06-24')?.state).toBe('MISSING')
  })

  test('DayViewModel states preserved from input array', () => {
    const days: DayViewModel[] = [
      { date: '2026-06-01', state: 'ENTERED', totalRevenue: 5000, revenueDayId: 'r1' },
      { date: '2026-06-02', state: 'DRAFT',   revenueDayId: 'r2' },
      { date: '2026-06-03', state: 'CLOSED',  revenueDayId: 'r3' },
    ]
    const flat = buildCalendarGrid(2026, 6, '2026-06-24', days).flat()
    expect(flat.find(c => c?.date === '2026-06-01')?.state).toBe('ENTERED')
    expect(flat.find(c => c?.date === '2026-06-02')?.state).toBe('DRAFT')
    expect(flat.find(c => c?.date === '2026-06-03')?.state).toBe('CLOSED')
  })

  test('ENTERED totalRevenue preserved', () => {
    const days: DayViewModel[] = [
      { date: '2026-06-05', state: 'ENTERED', totalRevenue: 12345, revenueDayId: 'r1' },
    ]
    const flat = buildCalendarGrid(2026, 6, '2026-06-24', days).flat()
    expect(flat.find(c => c?.date === '2026-06-05')?.totalRevenue).toBe(12345)
  })

  test('entire future month: all non-null cells → FUTURE', () => {
    // todayDhaka is in June; July is a future month
    const grid = buildCalendarGrid(2026, 7, '2026-06-24', [])
    const nonNull = grid.flat().filter(c => c !== null)
    expect(nonNull.every(c => c?.state === 'FUTURE')).toBe(true)
    expect(nonNull).toHaveLength(31)  // July has 31 days
  })
})

// ── tapRoute ──────────────────────────────────────────────────────────────────

describe('tapRoute', () => {
  test('null → null', () => {
    expect(tapRoute(null)).toBeNull()
  })

  test('MISSING → wizard URL', () => {
    expect(tapRoute({ date: '2026-06-10', state: 'MISSING' }))
      .toBe('/revenue/wizard?date=2026-06-10')
  })

  test('DRAFT → wizard URL (resume)', () => {
    expect(tapRoute({ date: '2026-06-10', state: 'DRAFT' }))
      .toBe('/revenue/wizard?date=2026-06-10')
  })

  test('ENTERED → day-view URL', () => {
    expect(tapRoute({ date: '2026-06-10', state: 'ENTERED' }))
      .toBe('/revenue/day/2026-06-10')
  })

  test('CLOSED → day-view URL', () => {
    expect(tapRoute({ date: '2026-06-10', state: 'CLOSED' }))
      .toBe('/revenue/day/2026-06-10')
  })

  test('FUTURE → null (not tappable)', () => {
    expect(tapRoute({ date: '2026-07-01', state: 'FUTURE' })).toBeNull()
  })
})

// ── Count header derivation (logic, not React) ────────────────────────────────

describe('count header — submitted/draft/missing from DayViewModel[]', () => {
  const days: DayViewModel[] = [
    { date: '2026-06-01', state: 'ENTERED',  revenueDayId: 'r1' },
    { date: '2026-06-02', state: 'ENTERED',  revenueDayId: 'r2' },
    { date: '2026-06-03', state: 'CLOSED',   revenueDayId: 'r3' },
    { date: '2026-06-04', state: 'DRAFT',    revenueDayId: 'r4' },
    { date: '2026-06-05', state: 'MISSING'  },
    { date: '2026-06-06', state: 'MISSING'  },
    { date: '2026-06-07', state: 'MISSING'  },
  ]

  test('submitted = ENTERED + CLOSED', () => {
    const submitted = days.filter(d => d.state === 'ENTERED' || d.state === 'CLOSED').length
    expect(submitted).toBe(3)
  })

  test('draft count', () => {
    expect(days.filter(d => d.state === 'DRAFT').length).toBe(1)
  })

  test('missing count', () => {
    expect(days.filter(d => d.state === 'MISSING').length).toBe(3)
  })
})

// ── Month helpers ─────────────────────────────────────────────────────────────

describe('prevMonth / nextMonth', () => {
  test('prevMonth crosses year boundary: 2026-01 → 2025-12', () => {
    expect(prevMonth('2026-01')).toBe('2025-12')
  })

  test('prevMonth: 2026-06 → 2026-05', () => {
    expect(prevMonth('2026-06')).toBe('2026-05')
  })

  test('nextMonth crosses year boundary: 2025-12 → 2026-01', () => {
    expect(nextMonth('2025-12')).toBe('2026-01')
  })

  test('nextMonth: 2026-05 → 2026-06', () => {
    expect(nextMonth('2026-05')).toBe('2026-06')
  })

  test('todayMonth extracts YYYY-MM from YYYY-MM-DD', () => {
    expect(todayMonth('2026-06-24')).toBe('2026-06')
  })
})
