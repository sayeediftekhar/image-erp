'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { DayViewModel, DayState } from '@/lib/revenue/classify'
import {
  buildCalendarGrid,
  tapRoute,
  prevMonth,
  nextMonth,
  monthLabel,
  todayMonth,
  type CalendarDay,
} from '@/lib/revenue/calendar-grid'

// ── Tile colours ──────────────────────────────────────────────────────────────

const TILE_COLOUR: Record<DayState, string> = {
  MISSING: 'bg-red-500 text-white',
  DRAFT:   'bg-amber-400 text-gray-900',
  ENTERED: 'bg-green-500 text-white',
  CLOSED:  'bg-gray-200 text-gray-500',
  FUTURE:  'text-gray-300',
}

// ── DayTile ───────────────────────────────────────────────────────────────────

interface DayTileProps {
  day:     CalendarDay
  isToday: boolean
  onTap?:  () => void
  locked?: boolean   // T3f-B hook — accepted here, not yet active
}

function DayTile({ day, isToday, onTap }: DayTileProps) {
  if (!day) return <div aria-hidden />

  const dayNum   = parseInt(day.date.slice(8), 10)
  const isFuture = day.state === 'FUTURE'
  const colour   = TILE_COLOUR[day.state]
  const todayRing = isToday ? 'ring-2 ring-indigo-900 ring-offset-1' : ''
  const base = `w-full aspect-square flex items-center justify-center rounded-lg text-sm font-semibold ${colour} ${todayRing}`

  if (isFuture || !onTap) {
    return (
      <div className={base} aria-label={`${day.date} future`}>
        {dayNum}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onTap}
      className={`${base} active:opacity-75`}
      aria-label={`${day.date} ${day.state.toLowerCase()}`}
    >
      {dayNum}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  days:       DayViewModel[]
  todayDhaka: string   // YYYY-MM-DD, server-resolved (Asia/Dhaka)
  month:      string   // YYYY-MM
  entityId:   string
}

export default function RevenueManagementClient({ days, todayDhaka, month }: Props) {
  const router = useRouter()

  const navigate = useCallback((m: string) => {
    router.push(`/revenue?month=${m}`)
  }, [router])

  const [year, monthNum] = month.split('-').map(Number)
  const currentMonth   = todayMonth(todayDhaka)
  const isFutureMonth  = month > currentMonth
  const isCurrentMonth = month === currentMonth

  const weeks = buildCalendarGrid(year, monthNum, todayDhaka, days)

  const submitted = days.filter(d => d.state === 'ENTERED' || d.state === 'CLOSED').length
  const draft     = days.filter(d => d.state === 'DRAFT').length
  const missing   = days.filter(d => d.state === 'MISSING').length

  return (
    <div
      className="min-h-full flex flex-col"
      style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="px-4 pt-5 pb-4">
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">
          Revenue Entry
        </p>
        <h1 className="text-white text-2xl font-bold leading-tight">Daily Summary</h1>
      </header>

      {/* ── Month switcher ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pb-2">
        <button
          onClick={() => navigate(prevMonth(month))}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white text-2xl font-bold rounded-lg"
          aria-label="Previous month"
        >
          ‹
        </button>

        <div className="flex flex-col items-center">
          <span className="text-white font-semibold text-base">{monthLabel(month)}</span>
          {!isCurrentMonth && (
            <button
              onClick={() => navigate(currentMonth)}
              className="text-white/60 text-xs mt-0.5 hover:text-white underline leading-none"
            >
              Today
            </button>
          )}
        </div>

        <button
          onClick={() => navigate(nextMonth(month))}
          disabled={isFutureMonth}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 text-2xl font-bold rounded-lg"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* ── Count header ─────────────────────────────────────────────────── */}
      <div className="mx-4 mb-4 grid grid-cols-3 gap-2">
        {[
          { label: 'Submitted', value: submitted, colour: 'text-green-300' },
          { label: 'Draft',     value: draft,     colour: 'text-amber-300' },
          { label: 'Missing',   value: missing,   colour: 'text-red-300'   },
        ].map(c => (
          <div key={c.label} className="bg-white/10 rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${c.colour}`}>{c.value}</p>
            <p className="text-white/60 text-xs mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* ── Calendar grid ────────────────────────────────────────────────── */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl px-3 pt-4 pb-6">
        <div className="max-w-[480px] mx-auto">

          {/* Weekday header */}
          <div className="grid grid-cols-7 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div
                key={i}
                className="text-center text-xs text-gray-400 font-medium py-1"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day tiles */}
          <div className="grid grid-cols-7 gap-1">
            {weeks.flatMap((week, wi) =>
              week.map((day, di) => {
                const route = tapRoute(day)
                return (
                  <DayTile
                    key={day ? day.date : `pad-${wi}-${di}`}
                    day={day}
                    isToday={day?.date === todayDhaka}
                    onTap={route !== null ? () => router.push(route) : undefined}
                    locked={false}
                  />
                )
              })
            )}
          </div>

          {isFutureMonth && (
            <p className="text-center text-gray-400 mt-6 text-sm">
              No entries to show for a future month.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
