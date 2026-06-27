'use client'

import { useCallback, useState } from 'react'
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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GateInfo {
  priorMonth:  string   // YYYY-MM — the month that must be resolved first
  missingCount: number
}

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
  locked?: boolean  // T3f-B: true → greyed lock treatment; tapping fires onTap (nudge)
}

function DayTile({ day, isToday, onTap, locked = false }: DayTileProps) {
  if (!day) return <div aria-hidden />

  const dayNum    = parseInt(day.date.slice(8), 10)
  const isFuture  = day.state === 'FUTURE'
  const todayRing = isToday ? 'ring-2 ring-indigo-900 ring-offset-1' : ''

  const colour = locked
    ? 'bg-gray-100 text-gray-400 border border-gray-200'
    : TILE_COLOUR[day.state]

  const base = `w-full aspect-square flex flex-col items-center justify-center rounded-lg text-sm font-semibold ${colour} ${todayRing}`

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
      aria-label={`${day.date} ${locked ? 'locked' : day.state.toLowerCase()}`}
    >
      <span>{dayNum}</span>
      {locked && <span className="text-[9px] leading-none mt-0.5">🔒</span>}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  days:       DayViewModel[]
  todayDhaka: string       // YYYY-MM-DD, server-resolved (Asia/Dhaka)
  month:      string       // YYYY-MM
  entityId:   string
  gateInfo?:  GateInfo | null  // non-null = this month is gated
}

export default function RevenueManagementClient({ days, todayDhaka, month, gateInfo }: Props) {
  const router = useRouter()
  const [showNudge, setShowNudge] = useState(false)

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

          {/* Gate banner — visible when this month is blocked */}
          {gateInfo && (
            <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-red-800 text-sm font-semibold">
                {monthLabel(gateInfo.priorMonth)} is incomplete
              </p>
              <p className="text-red-700 text-xs mt-0.5">
                {gateInfo.missingCount} unresolved day{gateInfo.missingCount !== 1 ? 's' : ''} — resolve them to enter this month
              </p>
              <button
                onClick={() => navigate(gateInfo.priorMonth)}
                className="mt-2 text-xs text-red-700 font-semibold underline"
              >
                Go to {monthLabel(gateInfo.priorMonth)} →
              </button>
            </div>
          )}

          {/* Day tiles */}
          <div className="grid grid-cols-7 gap-1">
            {weeks.flatMap((week, wi) =>
              week.map((day, di) => {
                const isEnterable = day?.state === 'MISSING' || day?.state === 'DRAFT'
                const isLocked    = !!gateInfo && isEnterable
                const route       = tapRoute(day)
                const onTap       = isLocked
                  ? () => setShowNudge(true)
                  : (route !== null ? () => router.push(route) : undefined)
                return (
                  <DayTile
                    key={day ? day.date : `pad-${wi}-${di}`}
                    day={day}
                    isToday={day?.date === todayDhaka}
                    onTap={onTap}
                    locked={isLocked}
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
      {/* ── Nudge modal (shown when a locked tile is tapped) ─────────────────── */}
      {gateInfo && showNudge && (
        <dialog
          open
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 border-none w-full h-full"
          onClick={e => { if (e.target === e.currentTarget) setShowNudge(false) }}
        >
          <div className="w-full max-w-sm mx-auto bg-white rounded-t-2xl shadow-2xl p-6 pb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              Finish {monthLabel(gateInfo.priorMonth)} first
            </h2>
            <p className="text-sm text-gray-600 mb-5">
              {monthLabel(gateInfo.priorMonth)} has{' '}
              <strong>{gateInfo.missingCount} unresolved day{gateInfo.missingCount !== 1 ? 's' : ''}</strong>.
              Submit them or mark them closed, then come back to enter this month.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowNudge(false); navigate(gateInfo.priorMonth) }}
                className="w-full min-h-[44px] text-white rounded-xl font-semibold text-sm"
                style={{ background: '#0F0A52' }}
              >
                Go to {monthLabel(gateInfo.priorMonth)} →
              </button>
              <button
                onClick={() => setShowNudge(false)}
                className="w-full min-h-[44px] border border-gray-300 text-gray-700 rounded-xl font-semibold text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}
