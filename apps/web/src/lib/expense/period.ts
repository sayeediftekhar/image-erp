import { getDhakaToday } from '@/lib/revenue/classify'
import { deriveFundLabel } from './routing'

// ── Period resolution ──────────────────────────────────────────────────────────

// Returns the first and last day of the month containing todayDhaka.
// todayDhaka must be YYYY-MM-DD (server-resolved Asia/Dhaka — never the browser clock).
export function getDefaultPeriod(todayDhaka: string): { from: string; to: string } {
  const [y, m] = todayDhaka.split('-').map(Number)
  const mm = String(m).padStart(2, '0')
  const lastDay = new Date(y, m, 0).getDate()
  return {
    from: `${y}-${mm}-01`,
    to:   `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, mo, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth()    === mo - 1 &&
    dt.getUTCDate()     === d
  )
}

// Validate and sanitise ?from= ?to= searchParams.
// Falls back to the current month on any error: missing, malformed, or from > to.
export function parsePeriodParams(
  params: { from?: string; to?: string },
  todayDhaka: string = getDhakaToday(),
): { from: string; to: string } {
  const { from, to } = params
  if (
    from && to &&
    isValidDate(from) && isValidDate(to) &&
    from <= to
  ) {
    return { from, to }
  }
  return getDefaultPeriod(todayDhaka)
}

// ── Spending totals (Card 1 — derived from fetched rows, no second DB round-trip) ──

export interface SpendingTotals {
  pi:       number
  rdf:      number
  transfer: number
}

// Aggregates PI / RDF / Transfer spending from already-fetched period rows.
// Uses deriveFundLabel (same function as the list rows) to keep fund classification
// in a single place. Transfer entries are fund movements, not operating spending —
// they are counted separately so the PI/RDF totals stay clean.
export function computeSpendingTotals(
  entries: Array<{
    debit_account:  string | null
    credit_account: string | null
    amount:         number
  }>,
): SpendingTotals {
  let pi = 0, rdf = 0, transfer = 0
  for (const row of entries) {
    const fund = deriveFundLabel(row.debit_account ?? '', row.credit_account ?? '')
    if      (fund === 'PI')       pi       += row.amount
    else if (fund === 'RDF')      rdf      += row.amount
    else if (fund === 'Transfer') transfer += row.amount
  }
  return { pi, rdf, transfer }
}
