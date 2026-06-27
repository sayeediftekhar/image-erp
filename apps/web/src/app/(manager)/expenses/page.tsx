import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { pool } from '@/lib/db/pool'
import { getDhakaToday } from '@/lib/revenue/classify'
import { parsePeriodParams, computeSpendingTotals } from '@/lib/expense/period'
import { formatExpenseTaka } from '@/lib/expense/routing'
import ExpenseListSection, { type ExpenseRow } from './ExpenseListSection'
import PeriodSelector from './PeriodSelector'

interface Props {
  searchParams: { from?: string; to?: string }
}

export default async function ExpensesPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id, active')
    .eq('id', user.id)
    .single()

  if (!appUser || !appUser.active) redirect('/login')
  if (!['ENTRY', 'ADMIN', 'HQ_FINANCE'].includes(appUser.role)) redirect('/login')

  const entityId = appUser.entity_id as string | null

  let entityName = ''
  if (entityId) {
    const { data: entity } = await supabase
      .from('entities')
      .select('name')
      .eq('id', entityId)
      .single()
    entityName = entity?.name ?? ''
  }

  // ── Period resolution ─────────────────────────────────────────────────────
  const period = parsePeriodParams(searchParams, getDhakaToday())

  // ── DB queries (entity-isolated, server-side) ─────────────────────────────
  let entries: ExpenseRow[] = []
  let pendingCount = 0
  let pendingTotal = 0

  if (entityId) {
    try {
      // Query 1: period-filtered expense list
      const listResult = await pool.query<ExpenseRow>(
        `SELECT
           je.id,
           je.entry_date::text                                              AS entry_date,
           je.description,
           je.ref                                                           AS voucher_number,
           je.cheque_number,
           je.status,
           MAX(CASE WHEN jl.debit  > 0 THEN jl.account_code END)           AS debit_account,
           MAX(CASE WHEN jl.credit > 0 THEN jl.account_code END)           AS credit_account,
           MAX(CASE WHEN jl.debit  > 0 THEN jl.debit  END)::float          AS amount
         FROM public.journal_entries je
         JOIN public.journal_lines jl ON jl.entry_id = je.id
         WHERE je.source_module = 'EXPENSE'
           AND je.entity_id = $1
           AND je.entry_date >= $2
           AND je.entry_date <= $3
         GROUP BY je.id, je.entry_date, je.description, je.ref,
                  je.cheque_number, je.status, je.entered_at
         ORDER BY je.entry_date DESC, je.entered_at DESC`,
        [entityId, period.from, period.to],
      )
      entries = listResult.rows

      // Query 2: all-current pending approvals (NOT period-scoped)
      const pendingResult = await pool.query<{ count: number; total: number }>(
        `SELECT
           COUNT(je.id)::int                                                AS count,
           COALESCE(SUM(jl.debit), 0)::float                               AS total
         FROM public.journal_entries je
         JOIN public.journal_lines jl ON jl.entry_id = je.id AND jl.debit > 0
         WHERE je.source_module = 'EXPENSE'
           AND je.entity_id = $1
           AND je.status = 'PENDING_APPROVAL'`,
        [entityId],
      )
      pendingCount = pendingResult.rows[0]?.count ?? 0
      pendingTotal = pendingResult.rows[0]?.total ?? 0
    } catch (err) {
      console.error('[expenses] query failed', err)
    }
  }

  // Card 1 totals: derived from already-fetched period rows (no extra DB trip)
  const spending = computeSpendingTotals(
    entries.map((r) => ({
      debit_account:  r.debit_account,
      credit_account: r.credit_account,
      amount:         r.amount,
    })),
  )

  // Period display label (short format, e.g. "1 Jun – 30 Jun 2026")
  function fmtShort(iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  }

  return (
    <div className="min-h-full flex flex-col">
      {/* Header */}
      <div
        className="px-4 pt-5 pb-6 shrink-0"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Expenses</p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-white text-2xl font-bold leading-tight">Expense Statement</h1>
            {entityName && (
              <p className="text-white/50 text-xs mt-0.5">{entityName}</p>
            )}
          </div>
          <Link
            href="/expenses/new"
            className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-4 rounded-xl text-sm font-semibold bg-white/15 text-white border border-white/20 hover:bg-white/25 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Post Expense
          </Link>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 overflow-y-auto">

        {/* Period selector */}
        <div className="pt-4 pb-2">
          <PeriodSelector from={period.from} to={period.to} />
          <p className="px-4 text-xs text-gray-400 mt-0.5">
            {fmtShort(period.from)} – {fmtShort(period.to)}
          </p>
        </div>

        {/* Summary cards */}
        <div className="px-4 pt-2 pb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">

          {/* Card 1 — Period spending */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Spending this period
            </p>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-600">PI</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatExpenseTaka(spending.pi)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-600">RDF</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatExpenseTaka(spending.rdf)}
                </span>
              </div>
              {spending.transfer > 0 && (
                <div className="flex items-baseline justify-between pt-1 border-t border-gray-100">
                  <span className="text-xs text-gray-400">Transfers (not spending)</span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {formatExpenseTaka(spending.transfer)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-2 border-t border-gray-200">
                <span className="text-sm font-semibold text-gray-700">Total</span>
                <span className="text-base font-bold tabular-nums" style={{ color: '#13007D' }}>
                  {formatExpenseTaka(spending.pi + spending.rdf)}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2 — Pending approvals (all-time) */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Pending approval
            </p>
            {pendingCount === 0 ? (
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="text-sm text-gray-500">None pending</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-gray-600">Entries</span>
                  <span className="text-sm font-semibold text-amber-700">{pendingCount}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-gray-600">Amount</span>
                  <span className="text-sm font-semibold text-amber-700 tabular-nums">
                    {formatExpenseTaka(pendingTotal)}
                  </span>
                </div>
                <p className="text-xs text-gray-400 pt-1">All-time — not period-filtered</p>
              </div>
            )}
          </div>
        </div>

        {/* Period-filtered expense list */}
        <ExpenseListSection entries={entries} periodLabel={`${fmtShort(period.from)} – ${fmtShort(period.to)}`} />
      </div>
    </div>
  )
}
