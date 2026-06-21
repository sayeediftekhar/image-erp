import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEntityCapabilities, hasDeliveries } from '@/lib/capabilities'
import { pool } from '@/lib/db/pool'
import { LedgerService, RevenueService, FlaggedBalance } from '@image-erp/posting-engine'

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function formatTaka(paisa: number): string {
  return `Tk ${(paisa / 100).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function BalanceRow({ b }: { b: FlaggedBalance }) {
  const isUrgent = b.days_open >= 7
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{b.patient_name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Admitted {formatDate(b.admission_date)}
            {b.receipt_no ? ` · Receipt ${b.receipt_no}` : ''}
          </p>
        </div>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
            isUrgent
              ? 'bg-red-100 text-red-700 border border-red-200'
              : 'bg-orange-100 text-orange-700 border border-orange-100'
          }`}
        >
          {b.days_open}d open
        </span>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
        <span>Advance paid: <strong className="text-gray-700">{formatTaka(b.advance_paid)}</strong></span>
        {b.expected_date && (
          <span>Expected discharge: <strong className="text-gray-700">{formatDate(b.expected_date)}</strong></span>
        )}
      </div>
    </div>
  )
}

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

  // Deliveries page should only be reachable for clinics with C-section tracking.
  // If somehow a non-csection clinic lands here (e.g. direct URL), redirect.
  if (!hasDeliveries(caps)) redirect('/dashboard')

  const ledger  = new LedgerService(pool)
  const revenue = new RevenueService(pool, ledger)
  const balances: FlaggedBalance[] = await revenue.getFlaggedOpenBalances(appUser.entity_id)

  return (
    <div className="min-h-full flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="px-4 pt-5 pb-6"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Deliveries</p>
        <h1 className="text-white text-2xl font-bold leading-tight">Open Delivery Balances</h1>
        <p className="text-white/60 text-sm mt-1">
          {balances.length === 0
            ? 'No open balances'
            : `${balances.length} open C-section balance${balances.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 px-4 pt-5 pb-6">
        {balances.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-2">
              <p className="text-gray-500 font-medium text-sm">All clear</p>
              <p className="text-gray-400 text-xs">No C-section admissions have open balances past the flag window.</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wide">
              Overdue — action needed
            </p>
            <div className="space-y-3">
              {balances.map(b => <BalanceRow key={b.id} b={b} />)}
            </div>
            <p className="text-xs text-gray-400 mt-4 text-center">
              Close a balance when the patient is discharged. Full close-balance action coming in T3e.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
