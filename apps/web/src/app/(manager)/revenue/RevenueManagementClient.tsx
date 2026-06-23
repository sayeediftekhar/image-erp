'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { DayViewModel, DayState } from '@/lib/revenue/classify'

interface Props {
  days:       DayViewModel[]
  todayDhaka: string   // YYYY-MM-DD, server-resolved
  month:      string   // YYYY-MM
  entityId:   string
}

// ── Month helpers ─────────────────────────────────────────────────────────────

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric',
  })
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function todayMonth(todayDhaka: string): string {
  return todayDhaka.slice(0, 7)
}

function formatDate(date: string): string {
  const [, , d] = date.split('-').map(Number)
  return `${d} ${new Date(date).toLocaleDateString('en-GB', { weekday: 'short' })}`
}

// ── State styling ─────────────────────────────────────────────────────────────

const STATE_CONFIG: Record<DayState, { label: string; pill: string; rowBg: string }> = {
  MISSING: {
    label:  'Missing',
    pill:   'bg-red-100 text-red-800 border border-red-200',
    rowBg:  'bg-white border-l-4 border-l-red-500',
  },
  DRAFT: {
    label:  'In progress',
    pill:   'bg-amber-100 text-amber-800 border border-amber-200',
    rowBg:  'bg-white border-l-4 border-l-amber-400',
  },
  ENTERED: {
    label:  'Entered',
    pill:   'bg-green-100 text-green-800 border border-green-200',
    rowBg:  'bg-white border-l-4 border-l-green-500',
  },
  CLOSED: {
    label:  'Closed',
    pill:   'bg-gray-100 text-gray-500 border border-gray-200',
    rowBg:  'bg-gray-50 border-l-4 border-l-gray-300',
  },
  FUTURE: {
    label:  'Future',
    pill:   'bg-gray-50 text-gray-300',
    rowBg:  'bg-gray-50',
  },
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RevenueManagementClient({
  days, todayDhaka, month, entityId,
}: Props) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [pendingDate, setPendingDate] = useState<string | null>(null)
  const [closing,     setClosing]     = useState(false)
  const [flashMsg,    setFlashMsg]    = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // ── Month navigation ───────────────────────────────────────────────────────
  const navigate = useCallback((m: string) => {
    router.push(`/revenue?month=${m}`)
  }, [router])

  const currentMonth = todayMonth(todayDhaka)
  const isFutureMonth = month > currentMonth

  // ── Counts ─────────────────────────────────────────────────────────────────
  const entered = days.filter(d => d.state === 'ENTERED').length
  const draft   = days.filter(d => d.state === 'DRAFT').length
  const missing = days.filter(d => d.state === 'MISSING').length

  const attentionDays  = days.filter(d => d.state === 'MISSING' || d.state === 'DRAFT')
  const submittedDays  = days.filter(d => d.state === 'ENTERED' || d.state === 'CLOSED')

  // ── Mark-closed flow ───────────────────────────────────────────────────────
  const openConfirm = (date: string) => {
    setPendingDate(date)
    dialogRef.current?.showModal()
  }

  const cancelConfirm = () => {
    dialogRef.current?.close()
    setPendingDate(null)
  }

  const confirmClose = async () => {
    if (!pendingDate) return
    setClosing(true)
    try {
      const res = await fetch('/api/manager/mark-closed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: pendingDate }),
      })
      dialogRef.current?.close()
      setPendingDate(null)
      if (res.ok) {
        setFlashMsg({ type: 'ok', text: `${pendingDate} marked closed.` })
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        setFlashMsg({
          type: 'err',
          text: (body as { error?: string }).error ?? `Error ${res.status}`,
        })
      }
    } catch {
      setFlashMsg({ type: 'err', text: 'Network error — please try again.' })
      dialogRef.current?.close()
      setPendingDate(null)
    } finally {
      setClosing(false)
    }
  }

  // ── Day row rendering ──────────────────────────────────────────────────────
  const renderRow = (day: DayViewModel) => {
    const cfg = STATE_CONFIG[day.state]
    const canWizard = day.state === 'MISSING' || day.state === 'DRAFT'
    const canClose  = day.state === 'MISSING'
    const canView   = day.state === 'ENTERED'

    return (
      <div
        key={day.date}
        className={`flex items-center justify-between px-4 py-3 rounded-lg mb-2 shadow-sm ${cfg.rowBg}`}
      >
        {/* Date + status pill */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-base font-semibold text-gray-900 w-16 flex-shrink-0">
            {formatDate(day.date)}
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.pill}`}>
            {cfg.label}
          </span>
          {day.state === 'ENTERED' && day.totalRevenue !== undefined && (
            <span className="text-sm text-gray-600 ml-1">
              Tk {day.totalRevenue.toLocaleString()}
            </span>
          )}
        </div>

        {/* Actions — minimum 44px touch targets */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {canWizard && (
            <button
              onClick={() => router.push(`/revenue/wizard?date=${day.date}`)}
              className="min-h-[44px] min-w-[44px] px-4 py-2 text-sm font-semibold text-white rounded-lg"
              style={{ background: '#13007D' }}
            >
              {day.state === 'MISSING' ? 'Start' : 'Continue'}
            </button>
          )}
          {canView && (
            <button
              onClick={() => router.push(`/revenue/day/${day.date}`)}
              className="min-h-[44px] min-w-[44px] px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 active:bg-gray-100"
            >
              View
            </button>
          )}
          {canClose && (
            <button
              onClick={() => openConfirm(day.date)}
              className="min-h-[44px] min-w-[44px] px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 active:bg-gray-100"
            >
              Mark closed
            </button>
          )}
        </div>
      </div>
    )
  }

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
      <div className="flex items-center justify-between px-4 pb-4">
        <button
          onClick={() => navigate(prevMonth(month))}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white text-xl font-bold rounded-lg"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-white font-semibold text-base">{monthLabel(month)}</span>
        <button
          onClick={() => navigate(nextMonth(month))}
          disabled={isFutureMonth}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 text-xl font-bold rounded-lg"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* ── Counts strip ─────────────────────────────────────────────────── */}
      <div className="mx-4 mb-4 grid grid-cols-3 gap-2">
        {[
          { label: 'Entered',  value: entered, colour: 'text-green-300'  },
          { label: 'Draft',    value: draft,   colour: 'text-amber-300'  },
          { label: 'Missing',  value: missing,  colour: 'text-red-300'    },
        ].map(c => (
          <div key={c.label} className="bg-white/10 rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${c.colour}`}>{c.value}</p>
            <p className="text-white/60 text-xs mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* ── Day list ─────────────────────────────────────────────────────── */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl px-4 pt-5 pb-6">
        {/* max-width container: rows read as an intentional column on desktop;
            on mobile (< 680px) this wrapper has no visual effect. */}
        <div className="max-w-[680px] mx-auto">

          {/* Flash message */}
          {flashMsg && (
            <div
              className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
                flashMsg.type === 'ok'
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
              role="alert"
            >
              {flashMsg.text}
              <button
                onClick={() => setFlashMsg(null)}
                className="ml-3 underline text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {days.length === 0 && (
            <p className="text-center text-gray-400 mt-10">
              {isFutureMonth ? 'No days to show for a future month.' : 'No data yet for this month.'}
            </p>
          )}

          {/* Attention zone */}
          {attentionDays.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Needs attention
              </p>
              {attentionDays.map(renderRow)}
            </section>
          )}

          {/* Divider */}
          {attentionDays.length > 0 && submittedDays.length > 0 && (
            <div className="my-4 border-t border-gray-200" />
          )}

          {/* Submitted zone */}
          {submittedDays.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Submitted
              </p>
              {submittedDays.map(renderRow)}
            </section>
          )}
        </div>
      </div>

      {/* ── Confirm dialog ────────────────────────────────────────────────── */}
      <dialog
        ref={dialogRef}
        className="rounded-2xl shadow-2xl w-full max-w-sm p-6 bg-white"
        onClose={cancelConfirm}
      >
        <h2 className="text-lg font-bold text-gray-900 mb-2">Mark day as closed?</h2>
        {pendingDate && (
          <p className="text-sm text-gray-600 mb-5">
            This will submit <strong>{pendingDate}</strong> as a holiday / zero-revenue day.
            <br />
            <span className="text-red-700 font-medium">
              Submits cannot be reversed. Only continue if the clinic was genuinely closed.
            </span>
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={cancelConfirm}
            disabled={closing}
            className="flex-1 min-h-[44px] border border-gray-300 text-gray-700 rounded-xl font-semibold text-sm"
          >
            Cancel
          </button>
          <button
            onClick={confirmClose}
            disabled={closing}
            className="flex-1 min-h-[44px] text-white rounded-xl font-semibold text-sm disabled:opacity-60"
            style={{ background: '#0F0A52' }}
          >
            {closing ? 'Closing…' : 'Yes, mark closed'}
          </button>
        </div>
      </dialog>
    </div>
  )
}
