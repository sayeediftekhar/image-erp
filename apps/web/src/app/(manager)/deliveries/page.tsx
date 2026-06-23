import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEntityCapabilities, hasDeliveries } from '@/lib/capabilities'
import { pool } from '@/lib/db/pool'
import { computeBalanceConsequence } from '@/lib/revenue/close-balance'

// ── Formatting helpers ─────────────────────────────────────────────────────────

function tk(taka: number): string {
  // advance_paid / final_balance_paid come from the DB as NUMERIC(15,2)::float,
  // already in Taka — do NOT divide by 100 (previous stub had this bug).
  return 'Tk ' + Math.round(taka).toLocaleString('en-IN')
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ── Data types ─────────────────────────────────────────────────────────────────

interface OpenBalance {
  id:               string
  patient_name:     string
  receipt_no:       string | null
  advance_paid:     number
  expected_date:    string | null
  admission_date:   string
  days_open:        number
}

interface ClosedBalance {
  id:               string
  patient_name:     string
  receipt_no:       string | null
  advance_paid:     number
  final_balance_paid: number | null
  closed_date:      string | null
  admission_date:   string
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function OpenRow({ b, flagDays }: { b: OpenBalance; flagDays: number }) {
  const isOverdue = b.days_open > flagDays
  const isUrgent  = b.days_open >= 7
  return (
    <Link
      href={`/deliveries/${b.id}`}
      className="block bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm active:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{b.patient_name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Admitted {fmtDate(b.admission_date)}
            {b.receipt_no ? ` · Receipt ${b.receipt_no}` : ''}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
          isUrgent
            ? 'bg-red-100 text-red-700 border border-red-200'
            : isOverdue
              ? 'bg-orange-100 text-orange-700 border border-orange-100'
              : 'bg-gray-100 text-gray-600 border border-gray-200'
        }`}>
          {b.days_open}d open
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>Advance held: <strong className="text-gray-700">{tk(b.advance_paid)}</strong></span>
        <span className="text-gray-400 font-medium">Record discharge →</span>
      </div>
    </Link>
  )
}

function ClosedRow({ b }: { b: ClosedBalance }) {
  const balancePaid = b.final_balance_paid ?? 0
  const consequence = computeBalanceConsequence(b.advance_paid, b.advance_paid + balancePaid)
  const label = balancePaid >= 0
    ? `Collected ${tk(consequence.amount)}`
    : `Refunded ${tk(consequence.amount)}`

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 opacity-80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700 truncate">{b.patient_name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Admitted {fmtDate(b.admission_date)}
            {b.receipt_no ? ` · Receipt ${b.receipt_no}` : ''}
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 bg-green-50 text-green-700 border border-green-100">
          Closed {b.closed_date ? fmtDate(b.closed_date) : ''}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Advance: {tk(b.advance_paid)} · {label}
      </p>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function DeliveriesPage() {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id')
    .eq('id', user.id)
    .single()

  if (!appUser || appUser.role !== 'ENTRY' || !appUser.entity_id) redirect('/home')

  const { data: entity } = await supabase
    .from('entities')
    .select('code')
    .eq('id', appUser.entity_id)
    .single()

  const caps = getEntityCapabilities(entity?.code ?? '')
  if (!hasDeliveries(caps)) redirect('/dashboard')

  const entityId = appUser.entity_id

  // ── Parallel queries ─────────────────────────────────────────────────────
  // A: all OPEN balances with days_open (entity-scoped).
  // B: flag_days setting.
  // C: recent CLOSED balances (last 10 for reassurance; full history is in the
  //    ledger audit trail and will be surfaced in Phase-4 reports).
  const [openResult, settingResult, closedResult] = await Promise.all([
    pool.query<OpenBalance>(
      `SELECT
         db.id,
         db.patient_name,
         db.receipt_no,
         db.advance_paid::float       AS advance_paid,
         db.expected_date::text       AS expected_date,
         rd.revenue_date::text        AS admission_date,
         (CURRENT_DATE - rd.revenue_date)::int AS days_open
       FROM public.delivery_balance db
       JOIN public.revenue_day rd ON rd.id = db.revenue_day_id
       WHERE db.status = 'OPEN' AND db.entity_id = $1
       ORDER BY rd.revenue_date ASC`,
      [entityId],
    ),
    pool.query<{ flag_days: number }>(
      `SELECT value::integer AS flag_days
       FROM public.settings
       WHERE key = 'delivery_balance_flag_days'`,
    ),
    pool.query<ClosedBalance>(
      `SELECT
         db.id,
         db.patient_name,
         db.receipt_no,
         db.advance_paid::float        AS advance_paid,
         db.final_balance_paid::float  AS final_balance_paid,
         db.closed_date::text          AS closed_date,
         rd.revenue_date::text         AS admission_date
       FROM public.delivery_balance db
       JOIN public.revenue_day rd ON rd.id = db.revenue_day_id
       WHERE db.status = 'CLOSED' AND db.entity_id = $1
       ORDER BY db.closed_date DESC
       LIMIT 10`,
      [entityId],
    ),
  ])

  const openBalances   = openResult.rows
  const flagDays       = settingResult.rows[0]?.flag_days ?? 4
  const closedBalances = closedResult.rows

  const overdueCount = openBalances.filter(b => b.days_open > flagDays).length

  return (
    <div className="min-h-full flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="px-4 pt-5 pb-6"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Deliveries</p>
        <h1 className="text-white text-2xl font-bold leading-tight">C-Section Balances</h1>
        <p className="text-white/60 text-sm mt-1">
          {openBalances.length === 0
            ? 'No open balances'
            : overdueCount > 0
              ? `${openBalances.length} open · ${overdueCount} overdue`
              : `${openBalances.length} open`}
        </p>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 px-4 pt-5 pb-6 space-y-6">

        {/* OPEN section */}
        {openBalances.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-2">
              <p className="text-gray-500 font-medium text-sm">All clear</p>
              <p className="text-gray-400 text-xs">
                No open C-section balances. Admit a new patient via the daily revenue wizard.
              </p>
            </div>
          </div>
        ) : (
          <section className="space-y-3">
            {overdueCount > 0 && (
              <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
                Overdue — record the discharge bill
              </p>
            )}
            {openBalances.map(b => (
              <OpenRow key={b.id} b={b} flagDays={flagDays} />
            ))}
          </section>
        )}

        {/* CLOSED section — recent discharges for reassurance */}
        {closedBalances.length > 0 && (
          <section className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Recent discharges
            </p>
            {closedBalances.map(b => (
              <ClosedRow key={b.id} b={b} />
            ))}
            <p className="text-xs text-gray-400 text-center pt-1">
              Showing last {closedBalances.length} discharge{closedBalances.length !== 1 ? 's' : ''}.
              Full history available in Phase-4 reports.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
