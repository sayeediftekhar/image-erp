import { deriveFundLabel, deriveCategoryLabel, formatExpenseTaka } from '@/lib/expense/routing'

export interface ExpenseRow {
  id:             string
  entry_date:     string
  description:    string
  voucher_number: string | null
  cheque_number:  string | null
  status:         string
  debit_account:  string | null
  credit_account: string | null
  amount:         number
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'POSTED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Posted
      </span>
    )
  }
  if (status === 'PENDING_APPROVAL') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
        Pending
      </span>
    )
  }
  return (
    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 flex-shrink-0">
      {status}
    </span>
  )
}

function ExpenseCard({ row }: { row: ExpenseRow }) {
  const debit  = row.debit_account  ?? ''
  const credit = row.credit_account ?? ''
  const fund     = deriveFundLabel(debit, credit)
  const category = deriveCategoryLabel(debit, credit)

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
      {/* Row 1: date + status */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400 font-medium">{fmtDate(row.entry_date)}</span>
        <StatusBadge status={row.status} />
      </div>

      {/* Row 2: description + amount */}
      <div className="flex items-baseline justify-between gap-3 mt-1.5">
        <p className="text-sm font-semibold text-gray-900 truncate">{row.description}</p>
        <span className="text-sm font-bold text-gray-900 flex-shrink-0 tabular-nums">
          {formatExpenseTaka(row.amount)}
        </span>
      </div>

      {/* Row 3: fund · category */}
      <p className="text-xs text-gray-500 mt-0.5">
        {fund}{category !== '—' ? ` · ${category}` : ''}
      </p>

      {/* Row 4: voucher# and cheque# */}
      {(row.voucher_number || row.cheque_number) && (
        <p className="text-xs text-gray-400 mt-1">
          {row.voucher_number && <span>Vchr: {row.voucher_number}</span>}
          {row.voucher_number && row.cheque_number && <span className="mx-1">·</span>}
          {row.cheque_number && <span>Chq: {row.cheque_number}</span>}
        </p>
      )}
    </div>
  )
}

interface Props {
  entries:      ExpenseRow[]
  periodLabel?: string
}

export default function ExpenseListSection({ entries, periodLabel }: Props) {
  return (
    <div className="px-4 pb-8">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {periodLabel ? `Expenses · ${periodLabel}` : 'Recent Expenses'}
        </p>
        {entries.length > 0 && (
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">
            {entries.length}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center">
          <svg
            className="mx-auto mb-2 text-gray-300"
            width="32" height="32" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <p className="text-sm text-gray-400">
            {periodLabel ? 'No expenses in this period' : 'No expenses recorded yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((row) => (
            <ExpenseCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}
