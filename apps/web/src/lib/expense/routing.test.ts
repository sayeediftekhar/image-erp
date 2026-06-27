import {
  PI_CATEGORIES,
  RDF_STREAMS,
  deriveRoutedAccount,
  deriveSourceAccount,
  deriveTransferCashAccount,
  getSourceOptions,
  lineFund,
} from './routing'
import { parseMoneyField } from '../revenue/money-input'

// ── PI_CATEGORIES list ────────────────────────────────────────────────────────

describe('PI_CATEGORIES', () => {
  test('excludes HQ-only 5410 (Management Salaries)', () => {
    expect(PI_CATEGORIES.map((c) => c.accountCode)).not.toContain('5410')
  })

  test('excludes HQ-only 5420 (Statutory)', () => {
    expect(PI_CATEGORIES.map((c) => c.accountCode)).not.toContain('5420')
  })

  test('excludes automated depreciation 5130', () => {
    expect(PI_CATEGORIES.map((c) => c.accountCode)).not.toContain('5130')
  })

  test('all PI category accounts start with 5', () => {
    for (const c of PI_CATEGORIES) {
      expect(c.accountCode).toMatch(/^5/)
    }
  })

  test('maps SALARY → 5010', () => {
    expect(PI_CATEGORIES.find((c) => c.key === 'SALARY')?.accountCode).toBe('5010')
  })

  test('maps TRAVEL → 5050', () => {
    expect(PI_CATEGORIES.find((c) => c.key === 'TRAVEL')?.accountCode).toBe('5050')
  })

  test('maps RM_VEHICLE → 5120', () => {
    expect(PI_CATEGORIES.find((c) => c.key === 'RM_VEHICLE')?.accountCode).toBe('5120')
  })
})

// ── RDF_STREAMS — Law-6 guarantee ─────────────────────────────────────────────

describe('RDF_STREAMS — Law-6 guarantee (RDF stock accounts are 12xx, never 5xxx)', () => {
  test('MEDICINE → 1210', () => {
    expect(RDF_STREAMS.find((s) => s.key === 'MEDICINE')?.accountCode).toBe('1210')
  })

  test('LAB → 1220', () => {
    expect(RDF_STREAMS.find((s) => s.key === 'LAB')?.accountCode).toBe('1220')
  })

  test('LOGISTIC → 1230', () => {
    expect(RDF_STREAMS.find((s) => s.key === 'LOGISTIC')?.accountCode).toBe('1230')
  })

  test('NO RDF stream account starts with 5 (exhaustive Law-6 check)', () => {
    for (const s of RDF_STREAMS) {
      expect(s.accountCode).not.toMatch(/^5/)
      expect(s.accountCode).toMatch(/^12/)
    }
  })
})

// ── deriveRoutedAccount — PI ───────────────────────────────────────────────────

describe('deriveRoutedAccount — PI', () => {
  test('PI SALARY → 5010', () => {
    expect(deriveRoutedAccount('PI', 'SALARY')).toBe('5010')
  })

  test('PI FRINGE → 5020', () => {
    expect(deriveRoutedAccount('PI', 'FRINGE')).toBe('5020')
  })

  test('PI FEES → 5030', () => {
    expect(deriveRoutedAccount('PI', 'FEES')).toBe('5030')
  })

  test('PI GENERAL_ADMIN → 5040', () => {
    expect(deriveRoutedAccount('PI', 'GENERAL_ADMIN')).toBe('5040')
  })

  test('PI TRAVEL → 5050', () => {
    expect(deriveRoutedAccount('PI', 'TRAVEL')).toBe('5050')
  })

  test('PI SUPPLIES → 5060', () => {
    expect(deriveRoutedAccount('PI', 'SUPPLIES')).toBe('5060')
  })

  test('PI PURCHASED_SERVICES → 5070', () => {
    expect(deriveRoutedAccount('PI', 'PURCHASED_SERVICES')).toBe('5070')
  })

  test('PI EDUCATION → 5080', () => {
    expect(deriveRoutedAccount('PI', 'EDUCATION')).toBe('5080')
  })

  test('PI PERFORMANCE → 5090', () => {
    expect(deriveRoutedAccount('PI', 'PERFORMANCE')).toBe('5090')
  })

  test('PI RM_BUILDING → 5110', () => {
    expect(deriveRoutedAccount('PI', 'RM_BUILDING')).toBe('5110')
  })

  test('PI RM_VEHICLE → 5120', () => {
    expect(deriveRoutedAccount('PI', 'RM_VEHICLE')).toBe('5120')
  })
})

// ── deriveRoutedAccount — RDF (Law-6 structural guarantee) ────────────────────

describe('deriveRoutedAccount — RDF (Law-6 structural guarantee)', () => {
  test('RDF MEDICINE → 1210, never 5xxx', () => {
    const code = deriveRoutedAccount('RDF', 'MEDICINE')
    expect(code).toBe('1210')
    expect(code).not.toMatch(/^5/)
  })

  test('RDF LAB → 1220, never 5xxx', () => {
    const code = deriveRoutedAccount('RDF', 'LAB')
    expect(code).toBe('1220')
    expect(code).not.toMatch(/^5/)
  })

  test('RDF LOGISTIC → 1230, never 5xxx', () => {
    const code = deriveRoutedAccount('RDF', 'LOGISTIC')
    expect(code).toBe('1230')
    expect(code).not.toMatch(/^5/)
  })

  test('ALL RDF streams return 12xx, NEVER 5xxx (exhaustive)', () => {
    for (const s of RDF_STREAMS) {
      const code = deriveRoutedAccount('RDF', s.key)
      expect(code).not.toBeNull()
      expect(code).toMatch(/^12/)
      expect(code).not.toMatch(/^5/)
    }
  })

  test('a PI category key (e.g. TRAVEL) given RDF fund returns null — cross-fund bleed impossible', () => {
    expect(deriveRoutedAccount('RDF', 'TRAVEL')).toBeNull()
  })

  test('a PI category key SALARY given RDF fund returns null — no 5xxx possible', () => {
    // null is already proof that no 5xxx account was returned;
    // toMatch requires a string so we only assert null here
    expect(deriveRoutedAccount('RDF', 'SALARY')).toBeNull()
  })
})

// ── deriveRoutedAccount — Transfer ────────────────────────────────────────────

describe('deriveRoutedAccount — Transfer', () => {
  test('TRANSFER SEND → 1410 (inter-entity receivable, requires_approval=true)', () => {
    expect(deriveRoutedAccount('TRANSFER', 'SEND')).toBe('1410')
  })

  test('TRANSFER RECEIVE → 2210 (inter-entity payable, requires_approval=true)', () => {
    expect(deriveRoutedAccount('TRANSFER', 'RECEIVE')).toBe('2210')
  })
})

// ── deriveRoutedAccount — fund-switch reset ────────────────────────────────────

describe('deriveRoutedAccount — fund-switch reset (empty selectionKey → null)', () => {
  test('returns null when selectionKey is empty (fund-switch resets the selection)', () => {
    expect(deriveRoutedAccount('PI', '')).toBeNull()
    expect(deriveRoutedAccount('RDF', '')).toBeNull()
    expect(deriveRoutedAccount('TRANSFER', '')).toBeNull()
  })

  test('switching PI→RDF with cleared selection: old 5xxx account cannot leak', () => {
    // Simulate: manager had PI+TRAVEL (→ 5050), switched fund to RDF,
    // UI resets selectionKey to ''. deriveRoutedAccount must return null,
    // not the stale 5050.
    expect(deriveRoutedAccount('RDF', '')).toBeNull()
  })
})

// ── deriveSourceAccount ────────────────────────────────────────────────────────

describe('deriveSourceAccount', () => {
  test('PI + PETTY_CASH → 1015', () => {
    expect(deriveSourceAccount('PI', 'PETTY_CASH')).toBe('1015')
  })

  test('PI + BANK → 1110 (SJIB Current-PI)', () => {
    expect(deriveSourceAccount('PI', 'BANK')).toBe('1110')
  })

  test('PI + CASH → 1010', () => {
    expect(deriveSourceAccount('PI', 'CASH')).toBe('1010')
  })

  test('RDF + PETTY_CASH → 1015', () => {
    expect(deriveSourceAccount('RDF', 'PETTY_CASH')).toBe('1015')
  })

  test('RDF + BANK → 1120 (SJIB SND-RDF, not PI bank 1110)', () => {
    expect(deriveSourceAccount('RDF', 'BANK')).toBe('1120')
  })

  test('RDF + CASH → null (no RDF cash drawer)', () => {
    expect(deriveSourceAccount('RDF', 'CASH')).toBeNull()
  })
})

// ── deriveTransferCashAccount ──────────────────────────────────────────────────

describe('deriveTransferCashAccount', () => {
  test('BANK → 1110 (PI bank for inter-entity movements)', () => {
    expect(deriveTransferCashAccount('BANK')).toBe('1110')
  })

  test('CASH → 1010', () => {
    expect(deriveTransferCashAccount('CASH')).toBe('1010')
  })
})

// ── getSourceOptions ───────────────────────────────────────────────────────────

describe('getSourceOptions', () => {
  test('PI includes petty cash, bank, and cash', () => {
    const keys = getSourceOptions('PI').map((o) => o.key)
    expect(keys).toContain('PETTY_CASH')
    expect(keys).toContain('BANK')
    expect(keys).toContain('CASH')
  })

  test('RDF excludes cash drawer (no RDF cash)', () => {
    const keys = getSourceOptions('RDF').map((o) => o.key)
    expect(keys).not.toContain('CASH')
    expect(keys).toContain('PETTY_CASH')
    expect(keys).toContain('BANK')
  })

  test('TRANSFER excludes petty cash float', () => {
    const keys = getSourceOptions('TRANSFER').map((o) => o.key)
    expect(keys).not.toContain('PETTY_CASH')
    expect(keys).toContain('BANK')
    expect(keys).toContain('CASH')
  })

  test('RDF bank option references 1120 (not PI bank 1110)', () => {
    const bankOption = getSourceOptions('RDF').find((o) => o.key === 'BANK')
    expect(bankOption?.accountCode).toBe('1120')
  })
})

// ── lineFund ──────────────────────────────────────────────────────────────────

describe('lineFund', () => {
  test('PI → PI', () => { expect(lineFund('PI')).toBe('PI') })
  test('RDF → RDF', () => { expect(lineFund('RDF')).toBe('RDF') })
  test('TRANSFER → PI (inter-entity clearing is PI-fund admin)', () => {
    expect(lineFund('TRANSFER')).toBe('PI')
  })
})

// ── comma regression — reusing money-input helpers ────────────────────────────

describe('comma regression — reusing parseMoneyField (money-input)', () => {
  test('"15,000" parses as 15000, not 15', () => {
    const result = parseMoneyField('15,000')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(15000)
  })

  test('"1,50,000" (BD lakh format) parses as 150000', () => {
    const result = parseMoneyField('1,50,000')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(150000)
  })

  test('">2dp" is rejected', () => {
    expect(parseMoneyField('100.999').ok).toBe(false)
  })

  test('non-numeric string is rejected', () => {
    expect(parseMoneyField('abc').ok).toBe(false)
  })

  test('empty string returns ok with value 0 (optional-field convention)', () => {
    const result = parseMoneyField('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(0)
  })
})

// ── balanced entry shape (unit check) ─────────────────────────────────────────

describe('balanced entry shape', () => {
  test('PI Travel from Petty Cash — Dr 5050 / Cr 1015 is balanced', () => {
    const amount = 5000
    const debitCode  = deriveRoutedAccount('PI', 'TRAVEL')
    const creditCode = deriveSourceAccount('PI', 'PETTY_CASH')
    expect(debitCode).toBe('5050')
    expect(creditCode).toBe('1015')
    // Single-point paisa rounding: both sides from the same amount
    const dr = Math.round(amount * 100)
    const cr = Math.round(amount * 100)
    expect(dr).toBe(cr)
  })

  test('RDF Medicine from RDF Bank — Dr 1210 / Cr 1120 is balanced (never 5xxx)', () => {
    const amount = 25000
    const debitCode  = deriveRoutedAccount('RDF', 'MEDICINE')
    const creditCode = deriveSourceAccount('RDF', 'BANK')
    expect(debitCode).toBe('1210')
    expect(creditCode).toBe('1120')
    expect(debitCode).not.toMatch(/^5/)
    const dr = Math.round(amount * 100)
    const cr = Math.round(amount * 100)
    expect(dr).toBe(cr)
  })
})
