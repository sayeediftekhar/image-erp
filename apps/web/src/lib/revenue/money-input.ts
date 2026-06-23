/**
 * Parse a typed string to a non-negative money amount quantised to whole paisa.
 *
 * Quantisation (Math.round(n*100)/100) is mandatory: the posting engine's
 * checkBalance applies Math.round(x*100) per-line, so a 3dp input like 4533.875
 * rounds differently as an individual credit line vs as part of an accumulated
 * debit sum — producing a 1-paisa debit/credit split that the engine correctly
 * rejects. Whole-paisa values are always within ~1e-10 of an integer after ×100,
 * making Math.round deterministic regardless of accumulation order.
 */
export function strToMoney(s: string): number {
  const v = parseFloat(s)
  if (!Number.isFinite(v) || v < 0) return 0
  return Math.round(v * 100) / 100
}

/** Parse a typed string to a non-negative integer count. */
export function strToInt(s: string): number {
  const v = parseInt(s, 10)
  return Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * Convert a saved number back to a display string.
 * Returns '' for zero so that inputs show the placeholder rather than "0".
 */
export function moneyToStr(n: number): string {
  return n > 0 ? String(n) : ''
}
