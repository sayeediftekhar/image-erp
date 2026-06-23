import { strToMoney, strToInt, moneyToStr } from './money-input'

describe('strToMoney — money field round-trip correctness', () => {
  // The core regression: browser blur must not mutate what the manager typed.
  // After the fix, the only path from user keystroke to draft_data is:
  //   e.target.value (string) → strToMoney → number stored in slice
  // so this test pins that path.
  test('2000 typed → exactly 2000 captured (no mutation)', () => {
    expect(strToMoney('2000')).toBe(2000)
  })

  test('1500.50 typed → 1500.5 (trailing zero stripped by JS is fine)', () => {
    expect(strToMoney('1500.50')).toBe(1500.5)
  })

  test('empty string → 0', () => {
    expect(strToMoney('')).toBe(0)
  })

  test('negative → 0 (floor at zero, same as previous numVal)', () => {
    expect(strToMoney('-500')).toBe(0)
  })

  test('non-numeric → 0', () => {
    expect(strToMoney('abc')).toBe(0)
  })

  test('"0" → 0', () => {
    expect(strToMoney('0')).toBe(0)
  })

  test('decimal without leading zero → correct', () => {
    expect(strToMoney('.5')).toBe(0.5)
  })
})

describe('strToInt', () => {
  test('50 typed → exactly 50', () => {
    expect(strToInt('50')).toBe(50)
  })

  test('empty → 0', () => {
    expect(strToInt('')).toBe(0)
  })

  test('negative → 0', () => {
    expect(strToInt('-3')).toBe(0)
  })

  test('float string → truncated integer', () => {
    expect(strToInt('3.9')).toBe(3)
  })
})

describe('moneyToStr', () => {
  test('2000 → "2000" (round-trips back to user-visible string)', () => {
    expect(moneyToStr(2000)).toBe('2000')
  })

  test('0 → "" (shows placeholder, not "0")', () => {
    expect(moneyToStr(0)).toBe('')
  })

  test('1500.5 → "1500.5"', () => {
    expect(moneyToStr(1500.5)).toBe('1500.5')
  })
})

// ── Paisa quantisation ────────────────────────────────────────────────────────
//
// The posting engine's checkBalance applies Math.round(x * 100) per LINE.
// When multiple income accounts contribute to a single fund debit (e.g. both
// 4010/outdoor-SC and 4050/USG feed into the 1010/piCash debit), the engine
// checks:
//
//   Math.round(piCash * 100)  vs  Σ Math.round(credit_i * 100)
//
// If any credit_i has 3+ decimal places sitting at a .5 paisa boundary, the
// two sides can diverge by 1 paisa — "sum of rounds ≠ round of sum".
//
// strToMoney quantises to 2dp on parse so no fractional-paisa value ever
// reaches draft_data.  With whole-paisa inputs, x * 100 is always within
// ~1e-10 of an integer, making Math.round deterministic regardless of
// accumulation order.

// Mirrors the engine's checkBalance logic (packages/posting-engine/src/ledger.service.ts).
// The engine is frozen; this copy exists only to make the regression test
// self-contained and independent of the posting-engine package.
function checkBalance(lines: {debit: number; credit: number}[]): boolean {
  const dr = lines.reduce((s, l) => s + Math.round(l.debit  * 100), 0)
  const cr = lines.reduce((s, l) => s + Math.round(l.credit * 100), 0)
  return dr === cr
}

describe('strToMoney — paisa quantisation', () => {
  test('3dp value quantised to 2dp (rounds up at exact .5 boundary)', () => {
    // 4533.875 * 100 = 453387.5 → Math.round = 453388 → / 100 = 4533.88
    expect(strToMoney('4533.875')).toBe(4533.88)
  })

  test('3dp value quantised to 2dp (rounds up second exact .5 boundary)', () => {
    // 25757.875 * 100 = 2575787.5 → Math.round = 2575788 → / 100 = 25757.88
    expect(strToMoney('25757.875')).toBe(25757.88)
  })

  test('2dp values pass through unchanged', () => {
    expect(strToMoney('4533.88')).toBe(4533.88)
    expect(strToMoney('25757.88')).toBe(25757.88)
  })
})

describe('balance divergence regression — Morning ~4534 + USG ~25758 = ~30291', () => {
  // Reproduces the "Σdebit 30291.xx ≠ Σcredit 30291.xx+1" failure pattern that
  // the engine correctly rejected before this fix.
  //
  // Scenario: morning session where service_charge AND USG revenue both
  // contribute to piCash/debit-1010 but are posted as separate PI credit lines
  // (4010 and 4050 respectively).  Both happen to land at the float .875
  // boundary — exactly representable in IEEE 754 — so each rounds UP when
  // Math.round is applied individually, but their sum is an exact integer
  // (30291.75 * 100 = 3029175) that does NOT round up.
  //
  // 4533.875 + 25757.875 ≈ morning ~4534 + USG ~25758, total ~30291 — the
  // same order of magnitude as the real failing day.  The exact reported
  // values (30291.88/.89) required a slightly different .5-boundary
  // combination that this test approximates with the clearest float example.

  const SC  = '4533.875'   // service_charge typed by manager → amt4010
  const USG = '25757.875'  // USG revenue typed by manager    → amt4050

  test('WITHOUT quantisation: raw 3dp values produce 1-paisa debit/credit split', () => {
    // Simulate old parseFloat-only behaviour
    const sc  = parseFloat(SC)   // = 4533.875 exactly
    const usg = parseFloat(USG)  // = 25757.875 exactly
    const piCash = sc + usg      // = 30291.75 exactly (no floating-point drift)

    const lines = [
      { debit: piCash, credit: 0   },   // Dr 1010 (fund debit = sum)
      { debit: 0,      credit: sc  },   // Cr 4010 (outdoor service charge)
      { debit: 0,      credit: usg },   // Cr 4050 (USG revenue)
    ]

    // Math.round(4533.875 * 100) = Math.round(453387.5) = 453388  ← UP
    // Math.round(25757.875 * 100) = Math.round(2575787.5) = 2575788 ← UP
    // Σcredits = 453388 + 2575788 = 3029176  → Cr = 30291.76
    // Math.round(30291.75 * 100)  = Math.round(3029175) = 3029175 → Dr = 30291.75
    expect(checkBalance(lines)).toBe(false)   // engine would reject: Dr ≠ Cr
  })

  test('WITH quantisation (strToMoney): 2dp values balance correctly', () => {
    const sc  = strToMoney(SC)   // 4533.88
    const usg = strToMoney(USG)  // 25757.88
    const piCash = sc + usg      // 30291.76 (float very close to exact)

    const lines = [
      { debit: piCash, credit: 0   },
      { debit: 0,      credit: sc  },
      { debit: 0,      credit: usg },
    ]

    // Math.round(4533.88 * 100) = 453388, Math.round(25757.88 * 100) = 2575788
    // Σcredits = 3029176
    // Math.round(piCash * 100) ≈ Math.round(3029176.0) = 3029176 ← matches
    expect(checkBalance(lines)).toBe(true)    // engine accepts: Dr = Cr = 30291.76
  })
})
