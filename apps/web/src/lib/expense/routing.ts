// Fund-first routing for the expense form.
// This module is the Law-6 enforcement mechanism: the RDF branch of
// deriveRoutedAccount can only return 12xx stock accounts — it is structurally
// incapable of returning a 5xxx expense account. Any post-submit server backstop
// in the route re-checks this via: if fund=RDF && !account.startsWith('12') → 403.

export type ExpenseFund = 'PI' | 'RDF' | 'TRANSFER'

export type PiCategoryKey =
  | 'SALARY' | 'FRINGE' | 'FEES' | 'GENERAL_ADMIN' | 'TRAVEL'
  | 'SUPPLIES' | 'PURCHASED_SERVICES' | 'EDUCATION' | 'PERFORMANCE'
  | 'RM_BUILDING' | 'RM_VEHICLE'

export type RdfStreamKey = 'MEDICINE' | 'LAB' | 'LOGISTIC'

export type TransferDirection = 'SEND' | 'RECEIVE'

export type ExpenseSource = 'PETTY_CASH' | 'BANK' | 'CASH'

export interface CategoryOption {
  key: PiCategoryKey
  label: string
  accountCode: string
  accountName: string
}

export interface StreamOption {
  key: RdfStreamKey
  label: string
  accountCode: string
  accountName: string
}

// HQ-only 5410 (Management Salaries) and 5420 (Statutory) are excluded — clinic
// managers never enter these. Depreciation 5130 is excluded — it is generated
// by the automated depreciation run, not by manual expense entry.
export const PI_CATEGORIES: CategoryOption[] = [
  { key: 'SALARY',             label: 'Salary & Wages',                accountCode: '5010', accountName: 'Salary & Wages' },
  { key: 'FRINGE',             label: 'Fringe & Benefits',             accountCode: '5020', accountName: 'Fringe & Benefits' },
  { key: 'FEES',               label: 'Fees, Honorarium & Allowances', accountCode: '5030', accountName: 'Fees, Honorarium & Allow.' },
  { key: 'GENERAL_ADMIN',      label: 'General Administration',        accountCode: '5040', accountName: 'General Administration' },
  { key: 'TRAVEL',             label: 'Travel',                        accountCode: '5050', accountName: 'Travel' },
  { key: 'SUPPLIES',           label: 'Supplies & Equipment',          accountCode: '5060', accountName: 'Supplies & Equipment' },
  { key: 'PURCHASED_SERVICES', label: 'Purchased Services',            accountCode: '5070', accountName: 'Purchased Services' },
  { key: 'EDUCATION',          label: 'Education',                     accountCode: '5080', accountName: 'Education' },
  { key: 'PERFORMANCE',        label: 'Performance',                   accountCode: '5090', accountName: 'Performance' },
  { key: 'RM_BUILDING',        label: 'R&M — Building',                accountCode: '5110', accountName: 'R&M — Building' },
  { key: 'RM_VEHICLE',         label: 'R&M — Vehicle',                 accountCode: '5120', accountName: 'R&M — Vehicle' },
]

// RDF streams map to STOCK asset accounts (12xx) exclusively — NEVER 5xxx (Law 6).
export const RDF_STREAMS: StreamOption[] = [
  { key: 'MEDICINE',  label: 'Medicine',  accountCode: '1210', accountName: 'RDF Stock — Medicines' },
  { key: 'LAB',       label: 'Lab',       accountCode: '1220', accountName: 'RDF Stock — Lab' },
  { key: 'LOGISTIC',  label: 'Logistic',  accountCode: '1230', accountName: 'RDF Stock — Logistic' },
]

// Derives the "routed" (non-source-of-funds) account by construction from fund + selection.
// For PI/RDF: this is the debit side (5xxx expense or 12xx stock).
// For TRANSFER SEND: debit 1410 (inter-entity receivable) / Cr [source].
// For TRANSFER RECEIVE: Dr [source] / credit 2210 (inter-entity payable).
// Returns null when selectionKey is empty — fund-switch resets selectionKey to '',
// which propagates null here, preventing any stale account surviving the switch.
export function deriveRoutedAccount(fund: ExpenseFund, selectionKey: string): string | null {
  if (!selectionKey) return null

  if (fund === 'PI') {
    return PI_CATEGORIES.find((c) => c.key === selectionKey)?.accountCode ?? null
  }

  if (fund === 'RDF') {
    // Law-6 structural guarantee: this branch can only return 12xx accounts.
    // The RDF_STREAMS array contains no 5xxx entries; find returns undefined for any
    // non-RDF key, safely producing null rather than an erroneous 5xxx fallthrough.
    return RDF_STREAMS.find((s) => s.key === selectionKey)?.accountCode ?? null
  }

  // TRANSFER: returns the "control" account (1410 for SEND, 2210 for RECEIVE).
  // Route/form swaps Dr/Cr sides for RECEIVE: Dr [source] / Cr 2210.
  if (selectionKey === 'SEND')    return '1410'
  if (selectionKey === 'RECEIVE') return '2210'
  return null
}

// Derives the source-of-funds (credit) account for PI and RDF transactions.
// Bank is fund-specific: PI bank = 1110 (SJIB Current-PI), RDF bank = 1120 (SJIB SND-RDF).
// Cash (1010) is PI only — there is no RDF cash drawer; returns null to signal
// the caller that the combination is invalid and should not be posted.
// Transfer sources use deriveTransferCashAccount (always PI bank/cash, no petty cash).
export function deriveSourceAccount(fund: 'PI' | 'RDF', source: ExpenseSource): string | null {
  if (source === 'PETTY_CASH') return '1015'
  if (source === 'BANK') return fund === 'PI' ? '1110' : '1120'
  if (source === 'CASH') return fund === 'PI' ? '1010' : null
  return null
}

// Transfer uses PI bank or PI cash — no petty cash float for inter-entity movements.
export function deriveTransferCashAccount(source: 'BANK' | 'CASH'): string {
  return source === 'BANK' ? '1110' : '1010'
}

// Source options available per fund.
// Transfer: bank (1110) or cash (1010) only — petty cash float is not used for
// inter-entity movements.
export function getSourceOptions(
  fund: ExpenseFund,
): Array<{ key: ExpenseSource; label: string; accountCode: string }> {
  if (fund === 'TRANSFER') {
    return [
      { key: 'BANK', label: 'Bank (1110)',  accountCode: '1110' },
      { key: 'CASH', label: 'Cash (1010)', accountCode: '1010' },
    ]
  }
  if (fund === 'PI') {
    return [
      { key: 'PETTY_CASH', label: 'Petty Cash Float (1015)', accountCode: '1015' },
      { key: 'BANK',       label: 'Bank (1110)',              accountCode: '1110' },
      { key: 'CASH',       label: 'Cash (1010)',              accountCode: '1010' },
    ]
  }
  // RDF: no cash drawer
  return [
    { key: 'PETTY_CASH', label: 'Petty Cash Float (1015)', accountCode: '1015' },
    { key: 'BANK',       label: 'Bank — RDF (1120)',        accountCode: '1120' },
  ]
}

// Returns the fund tag to use on both journal_lines for a given expense fund.
// Transfer is a PI-fund administrative movement (inter-entity clearing accounts
// 1410/2210 sit in the PI fund namespace).
export function lineFund(fund: ExpenseFund): 'PI' | 'RDF' {
  return fund === 'RDF' ? 'RDF' : 'PI'
}

// ── List-display helpers (account → label, reverse of the form's forward direction) ──

// Derives the fund label for a journal_entry row from its debit + credit account codes.
// Transfer RECEIVE is detected via creditAccount='2210' (debit side is cash/bank).
// Falls back to the raw debit account code — visible in the UI rather than silently blank.
export function deriveFundLabel(debitAccount: string, creditAccount: string): string {
  if (debitAccount.startsWith('5')) return 'PI'
  if (debitAccount.startsWith('12')) return 'RDF'
  if (debitAccount === '1410') return 'Transfer'
  if (creditAccount === '2210') return 'Transfer'
  return debitAccount
}

// Derives the category/stream/direction label from debit + credit account codes.
// Uses PI_CATEGORIES and RDF_STREAMS in reverse — no description-string parsing.
export function deriveCategoryLabel(debitAccount: string, creditAccount: string): string {
  const piMatch = PI_CATEGORIES.find((c) => c.accountCode === debitAccount)
  if (piMatch) return piMatch.label

  const rdfMatch = RDF_STREAMS.find((s) => s.accountCode === debitAccount)
  if (rdfMatch) return rdfMatch.label

  if (debitAccount === '1410') return 'Send to HQ/clinic'
  if (creditAccount === '2210') return 'Receive from HQ/clinic'
  return '—'
}

// Formats a Taka amount from journal_lines.debit (NUMERIC(15,2), already in Taka).
// DO NOT divide by 100 — the stored value is Taka-decimal, not integer paisa.
// 5000 → 'Tk 5,000'; 458900 → 'Tk 4,58,900' (en-IN lakh grouping).
export function formatExpenseTaka(taka: number): string {
  return 'Tk ' + Math.round(taka).toLocaleString('en-IN')
}
