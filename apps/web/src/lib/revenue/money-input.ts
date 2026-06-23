/**
 * Parse a typed string to a non-negative money amount quantised to whole paisa.
 *
 * Quantisation (Math.round(n*100)/100) is mandatory: the posting engine's
 * checkBalance applies Math.round(x*100) per-line, so a 3dp input like 4533.875
 * rounds differently as an individual credit line vs as part of an accumulated
 * debit sum — producing a 1-paisa debit/credit split that the engine correctly
 * rejects. Whole-paisa values are always within ~1e-10 of an integer after ×100,
 * making Math.round deterministic regardless of accumulation order.
 *
 * COMMA FIX: parseFloat("15,000") = 15 (stops at comma). strToMoney now strips
 * commas first and validates the full string so "15,000" → 15000, not 15.
 */
export function strToMoney(s: string): number {
  const stripped = s.replace(/,/g, '')
  if (stripped === '' || stripped === '.') return 0
  if (!/^\d*\.?\d*$/.test(stripped)) return 0
  const v = parseFloat(stripped)
  if (!Number.isFinite(v) || v < 0) return 0
  return Math.round(v * 100) / 100
}

/** Parse a typed string to a non-negative integer count. Strips commas; rejects decimals. */
export function strToInt(s: string): number {
  const stripped = s.replace(/,/g, '')
  if (!/^\d+$/.test(stripped)) return 0
  const v = parseInt(stripped, 10)
  return Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * Convert a saved number back to a display string.
 * Returns '' for zero so that inputs show the placeholder rather than "0".
 */
export function moneyToStr(n: number): string {
  return n > 0 ? String(n) : ''
}

// ── Result type ───────────────────────────────────────────────────────────────

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

// ── onChange sanitisers (keystroke-block) ─────────────────────────────────────
//
// Money/integer fields block invalid chars on every keystroke via sanitise-in-onChange.
// The valid char set is tiny so there is no legitimate partial entry that looks wrong.
// Phone/date/text fields are allow-then-flag (complex format, partial entry is valid).

/**
 * Strip commas and non-numeric chars from a money input string.
 * Keeps at most ONE decimal point (the first); a second dot and everything
 * after it is dropped entirely — never reflow digits across a dropped separator.
 * Decimal part is capped at 2 digits (keystroke-block for sub-paisa entry).
 *
 * Examples:
 *   "15,000"    → "15000"
 *   "15,00,000" → "1500000"   (BD lakh format)
 *   "15.999"    → "15.99"     (3rd decimal digit blocked)
 *   "1.2.3"     → "1.2"       (second dot + "3" dropped, NOT merged to "1.23")
 *   "15.00.00"  → "15.00"     (same rule)
 *   "abc"       → ""
 */
export function sanitizeMoney(raw: string): string {
  const stripped = raw.replace(/,/g, '').replace(/[^0-9.]/g, '')
  const parts = stripped.split('.')
  if (parts.length < 2) return parts[0] ?? ''
  // Only the first decimal segment; cap at 2 digits; everything after the second dot is dropped
  return parts[0] + '.' + parts[1].slice(0, 2)
}

/**
 * Strip everything except digits from a count/integer input string.
 * "15,000" → "15000", "3.5" → "35", "abc" → ""
 */
export function sanitizeCount(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

// ── Save-time validators (erroring) ───────────────────────────────────────────
//
// Every user-entered money field's SAVE path must use parseMoneyField, not bare
// strToMoney. strToMoney remains lenient (quantises) for live preview only.
//
// NOTE (not built): field-level validation cannot catch implausible-but-valid
// amounts (e.g., 453,453 Tk medicine charge — see DIS-e12157a1). A soft
// cross-field sanity layer (warn-and-confirm on out-of-range amounts) is the
// natural follow-up.

/**
 * Save-time validator for money fields. Returns ok(0) for empty (optional field).
 * Errors on: non-numeric, >2 decimal places.
 * Does NOT quantise — the system must not silently change the manager's number.
 */
export function parseMoneyField(raw: string): ParseResult<number> {
  if (raw === '' || raw === '.') return { ok: true, value: 0 }
  const stripped = raw.replace(/,/g, '')
  if (!/^\d*\.?\d*$/.test(stripped)) return { ok: false, error: 'Invalid amount' }
  const v = parseFloat(stripped)
  if (!Number.isFinite(v) || v < 0) return { ok: false, error: 'Invalid amount' }
  const dotIdx = stripped.indexOf('.')
  if (dotIdx !== -1 && stripped.length - dotIdx - 1 > 2) {
    return { ok: false, error: 'Too many decimal places (max 2)' }
  }
  return { ok: true, value: v }
}

/**
 * Save-time validator for integer count fields. Returns ok(0) for empty.
 * Errors on: decimal point, non-digits.
 */
export function parseCountField(raw: string): ParseResult<number> {
  if (raw === '') return { ok: true, value: 0 }
  const stripped = raw.replace(/,/g, '')
  if (!/^\d+$/.test(stripped)) return { ok: false, error: 'Whole number only' }
  const v = parseInt(stripped, 10)
  return { ok: true, value: v }
}
