import { getDefaultPeriod, parsePeriodParams, computeSpendingTotals } from './period'

// ── getDefaultPeriod ──────────────────────────────────────────────────────────

describe('getDefaultPeriod', () => {
  test('mid-June → first and last day of June', () => {
    const result = getDefaultPeriod('2026-06-27')
    expect(result.from).toBe('2026-06-01')
    expect(result.to).toBe('2026-06-30')
  })

  test('January → 31 days', () => {
    const result = getDefaultPeriod('2026-01-15')
    expect(result.from).toBe('2026-01-01')
    expect(result.to).toBe('2026-01-31')
  })

  test('leap year February 2024 → last day is 29', () => {
    const result = getDefaultPeriod('2024-02-10')
    expect(result.from).toBe('2024-02-01')
    expect(result.to).toBe('2024-02-29')
  })

  test('non-leap year February 2025 → last day is 28', () => {
    const result = getDefaultPeriod('2025-02-01')
    expect(result.from).toBe('2025-02-01')
    expect(result.to).toBe('2025-02-28')
  })
})

// ── parsePeriodParams ─────────────────────────────────────────────────────────

describe('parsePeriodParams', () => {
  const TODAY = '2026-06-27'

  test('valid from/to pass through unchanged', () => {
    const result = parsePeriodParams({ from: '2026-05-01', to: '2026-05-31' }, TODAY)
    expect(result.from).toBe('2026-05-01')
    expect(result.to).toBe('2026-05-31')
  })

  test('from === to (single day) is valid', () => {
    const result = parsePeriodParams({ from: '2026-06-15', to: '2026-06-15' }, TODAY)
    expect(result.from).toBe('2026-06-15')
    expect(result.to).toBe('2026-06-15')
  })

  test('from > to falls back to current month', () => {
    const result = parsePeriodParams({ from: '2026-06-30', to: '2026-06-01' }, TODAY)
    expect(result.from).toBe('2026-06-01')
    expect(result.to).toBe('2026-06-30')
  })

  test('malformed from string falls back to current month', () => {
    const result = parsePeriodParams({ from: 'not-a-date', to: '2026-06-30' }, TODAY)
    expect(result.from).toBe('2026-06-01')
    expect(result.to).toBe('2026-06-30')
  })

  test('missing both params falls back to current month', () => {
    const result = parsePeriodParams({}, TODAY)
    expect(result.from).toBe('2026-06-01')
    expect(result.to).toBe('2026-06-30')
  })

  test('missing to param falls back to current month', () => {
    const result = parsePeriodParams({ from: '2026-06-01' }, TODAY)
    expect(result.from).toBe('2026-06-01')
    expect(result.to).toBe('2026-06-30')
  })

  test('invalid calendar date (2026-02-30) falls back', () => {
    const result = parsePeriodParams({ from: '2026-02-30', to: '2026-06-30' }, TODAY)
    expect(result.from).toBe('2026-06-01')
    expect(result.to).toBe('2026-06-30')
  })
})

// ── computeSpendingTotals ─────────────────────────────────────────────────────

describe('computeSpendingTotals', () => {
  test('PI-only entries sum to pi, rdf=0, transfer=0', () => {
    const rows = [
      { debit_account: '5050', credit_account: '1015', amount: 5000 },
      { debit_account: '5010', credit_account: '1015', amount: 458900 },
    ]
    const totals = computeSpendingTotals(rows)
    expect(totals.pi).toBe(463900)
    expect(totals.rdf).toBe(0)
    expect(totals.transfer).toBe(0)
  })

  test('mixed PI + RDF split correctly', () => {
    const rows = [
      { debit_account: '5050', credit_account: '1015', amount: 1500 },
      { debit_account: '1210', credit_account: '1120', amount: 25000 },
      { debit_account: '1230', credit_account: '1015', amount: 8000 },
    ]
    const totals = computeSpendingTotals(rows)
    expect(totals.pi).toBe(1500)
    expect(totals.rdf).toBe(33000)
    expect(totals.transfer).toBe(0)
  })

  test('Transfer SEND (debit=1410) goes to transfer, not pi', () => {
    const rows = [
      { debit_account: '1410', credit_account: '1010', amount: 5000 },
    ]
    const totals = computeSpendingTotals(rows)
    expect(totals.pi).toBe(0)
    expect(totals.transfer).toBe(5000)
  })

  test('Transfer RECEIVE (debit=1010, credit=2210) goes to transfer, not pi', () => {
    const rows = [
      { debit_account: '1010', credit_account: '2210', amount: 3000 },
    ]
    const totals = computeSpendingTotals(rows)
    expect(totals.pi).toBe(0)
    expect(totals.transfer).toBe(3000)
  })

  test('empty entries → all zeros', () => {
    const totals = computeSpendingTotals([])
    expect(totals.pi).toBe(0)
    expect(totals.rdf).toBe(0)
    expect(totals.transfer).toBe(0)
  })
})
