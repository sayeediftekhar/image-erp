import type { DayViewModel, DayState } from './classify'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CalendarDay = {
  date: string
  state: DayState
  totalRevenue?: number
} | null   // null = padding cell (keeps 7-col grid shape)

// ── Month helpers ─────────────────────────────────────────────────────────────

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function todayMonth(todayDhaka: string): string {
  return todayDhaka.slice(0, 7)
}

// ── Calendar grid builder ─────────────────────────────────────────────────────
//
// Pure function: no React, no side effects. Exportable for tests.
//
// classifyDays omits FUTURE days entirely. This function bridges that gap by
// iterating every day 1..daysInMonth and inserting FUTURE for days > todayDhaka
// that are not in the input array.
//
// Week layout: Sunday-first. Leading padding = new Date(year, month-1, 1).getDay()
// (Sun=0, Mon=1, … Sat=6 — getDay() directly, no offset).

export function buildCalendarGrid(
  year:       number,
  month:      number,
  todayDhaka: string,
  days:       DayViewModel[],
): CalendarDay[][] {
  const byDate = new Map<string, DayViewModel>()
  for (const d of days) byDate.set(d.date, d)

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDow    = new Date(year, month - 1, 1).getDay()  // 0=Sun (Sunday-first)

  const cells: CalendarDay[] = Array(firstDow).fill(null)

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const row  = byDate.get(date)
    if (row) {
      cells.push({ date: row.date, state: row.state, totalRevenue: row.totalRevenue })
    } else {
      cells.push({ date, state: date > todayDhaka ? 'FUTURE' : 'MISSING' })
    }
  }

  const weeks: CalendarDay[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7)
    while (week.length < 7) week.push(null)   // trailing padding to complete last week
    weeks.push(week)
  }
  return weeks
}

// ── Tap routing ────────────────────────────────────────────────────────────────

export function tapRoute(day: CalendarDay): string | null {
  if (!day) return null
  switch (day.state) {
    case 'MISSING':
    case 'DRAFT':
      return `/revenue/wizard?date=${day.date}`
    case 'ENTERED':
    case 'CLOSED':
      // CLOSED days have status='SUBMITTED' + zero revenue in DB.
      // The day-view page checks status !== 'SUBMITTED' only, so CLOSED passes
      // and renders ReviewStep showing zeros — acceptable plain display.
      return `/revenue/day/${day.date}`
    case 'FUTURE':
      return null
  }
}
