import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { classifyDays, getDhakaToday, DayViewModel } from '@/lib/revenue/classify'
import { getEntityCapabilities, hasDeliveries } from '@/lib/capabilities'
import { pool } from '@/lib/db/pool'
import { LedgerService, RevenueService, FlaggedBalance } from '@image-erp/posting-engine'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  })
}

// ── Widgets ───────────────────────────────────────────────────────────────────

function AttentionWidget({ missing, draft }: { missing: DayViewModel[]; draft: DayViewModel[] }) {
  const total = missing.length + draft.length
  if (total === 0) {
    return (
      <div className="bg-green-50 border border-green-100 rounded-xl p-4">
        <p className="text-green-800 font-semibold text-sm">All caught up</p>
        <p className="text-green-600 text-xs mt-0.5">No missing or draft days this month.</p>
      </div>
    )
  }

  const preview = [...missing, ...draft].slice(0, 3)

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {total} day{total !== 1 ? 's' : ''} need entry
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {missing.length} missing · {draft.length} in draft
          </p>
        </div>
        <Link
          href="/revenue"
          className="text-xs font-semibold text-navy-vivid hover:underline"
        >
          View all →
        </Link>
      </div>
      <div className="divide-y divide-gray-50">
        {preview.map(day => (
          <Link
            key={day.date}
            href={`/revenue/wizard?date=${day.date}`}
            className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  day.state === 'MISSING' ? 'bg-red-500' : 'bg-amber-400'
                }`}
              />
              <span className="text-sm text-gray-800">{formatDate(day.date)}</span>
            </div>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                day.state === 'MISSING'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {day.state === 'MISSING' ? 'Missing' : 'Draft'}
            </span>
          </Link>
        ))}
      </div>
      {total > 3 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <Link href="/revenue" className="text-xs text-gray-500 hover:text-gray-700">
            +{total - 3} more — see full list
          </Link>
        </div>
      )}
    </div>
  )
}

function OverdueWidget({ balances }: { balances: FlaggedBalance[] }) {
  if (balances.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-900 mb-0.5">Delivery balances</p>
        <p className="text-xs text-gray-500">No overdue balances. All open admissions are within the flag window.</p>
      </div>
    )
  }

  const preview = balances.slice(0, 3)

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {balances.length} overdue delivery balance{balances.length !== 1 ? 's' : ''}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Open C-section admissions past flag window</p>
        </div>
        <Link href="/deliveries" className="text-xs font-semibold text-navy-vivid hover:underline">
          View all →
        </Link>
      </div>
      <div className="divide-y divide-gray-50">
        {preview.map(b => (
          <div key={b.id} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <p className="text-sm text-gray-800">{b.patient_name}</p>
              <p className="text-xs text-gray-400">Admitted {formatDate(b.admission_date)}</p>
            </div>
            <span className="text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-full flex-shrink-0">
              {b.days_open}d open
            </span>
          </div>
        ))}
      </div>
      {balances.length > 3 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <Link href="/deliveries" className="text-xs text-gray-500 hover:text-gray-700">
            +{balances.length - 3} more
          </Link>
        </div>
      )}
    </div>
  )
}

function MonthGlance({
  entered, draft, missing, month,
}: {
  entered: number; draft: number; missing: number; month: string
}) {
  const [y, m] = month.split('-').map(Number)
  const label = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{label}</p>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Entered',  value: entered, colour: 'text-green-600' },
          { label: 'Draft',    value: draft,   colour: 'text-amber-600' },
          { label: 'Missing',  value: missing, colour: 'text-red-600'   },
        ].map(c => (
          <div key={c.label} className="text-center">
            <p className={`text-2xl font-bold ${c.colour}`}>{c.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function StubTile({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-4">
      <p className="text-sm font-medium text-gray-400">{title}</p>
      <p className="text-xs text-gray-300 mt-0.5">{phase} · coming soon</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
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
    .select('code, name')
    .eq('id', appUser.entity_id)
    .single()

  const entityCode = entity?.code ?? ''
  const entityName = entity?.name ?? 'Your clinic'
  const caps = getEntityCapabilities(entityCode)

  // ── Revenue days for current month ──────────────────────────────────────────
  const todayDhaka = getDhakaToday()
  const [todayY, todayM] = todayDhaka.split('-').map(Number)
  const daysInMonth = new Date(todayY, todayM, 0).getDate()
  const startDate   = `${todayY}-${String(todayM).padStart(2, '0')}-01`
  const endDate     = `${todayY}-${String(todayM).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  const monthStr    = `${todayY}-${String(todayM).padStart(2, '0')}`

  const { data: rows } = await supabase
    .from('revenue_day')
    .select('id, revenue_date, status, total_revenue')
    .eq('entity_id', appUser.entity_id)
    .gte('revenue_date', startDate)
    .lte('revenue_date', endDate)

  const days    = classifyDays(rows ?? [], todayDhaka, todayY, todayM)
  const missing = days.filter(d => d.state === 'MISSING')
  const draft   = days.filter(d => d.state === 'DRAFT')
  const entered = days.filter(d => d.state === 'ENTERED').length

  // ── Overdue delivery balances (JAL/NAS only) ────────────────────────────────
  let overdueBalances: FlaggedBalance[] = []
  if (hasDeliveries(caps)) {
    const ledger  = new LedgerService(pool)
    const revenue = new RevenueService(pool, ledger)
    overdueBalances = await revenue.getFlaggedOpenBalances(appUser.entity_id)
  }

  return (
    <div className="min-h-full flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="px-4 pt-5 pb-6"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">
          Dashboard
        </p>
        <h1 className="text-white text-2xl font-bold leading-tight">{entityName}</h1>
        <p className="text-white/60 text-sm mt-1">What needs your attention</p>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 px-4 pt-5 pb-6 space-y-4">

        {/* Missing / draft attention */}
        <AttentionWidget missing={missing} draft={draft} />

        {/* Overdue delivery balances — JAL/NAS only */}
        {hasDeliveries(caps) && <OverdueWidget balances={overdueBalances} />}

        {/* Month at a glance */}
        <MonthGlance entered={entered} draft={draft.length} missing={missing.length} month={monthStr} />

        {/* Stub tiles */}
        <div className="grid grid-cols-2 gap-3">
          <StubTile title="Expenses" phase="Phase 2" />
          <StubTile title="Reports"  phase="Phase 4" />
        </div>

      </div>
    </div>
  )
}
