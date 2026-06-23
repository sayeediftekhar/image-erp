// Pure helpers for the C-section discharge (close-balance) flow.
// No DOM imports — safe for Jest node env.

export interface BalanceConsequence {
  type:   'collect' | 'refund'
  amount: number   // Taka, whole-paisa (≥ 0)
}

/**
 * Compute the cash consequence of a discharge bill relative to the advance held.
 *
 * Mirrors the engine's `balancePaid = totalBill − advance` exactly:
 *   totalBill > advance  → patient pays the remaining balance  (collect)
 *   totalBill < advance  → overpayment; clinic refunds patient  (refund)
 *   totalBill === advance → exact match, no further cash movement (collect 0)
 *
 * Quantises to whole paisa (Math.round × 100 / 100) so the display figure
 * matches what the engine will post.
 */
export function computeBalanceConsequence(
  advance:   number,
  totalBill: number,
): BalanceConsequence {
  const diff = Math.round((totalBill - advance) * 100) / 100
  return diff >= 0
    ? { type: 'collect', amount: diff }
    : { type: 'refund',  amount: -diff }
}

export class EntityAccessError extends Error {
  constructor(
    readonly status: 403,
    message: string,
  ) {
    super(message)
    this.name = 'EntityAccessError'
  }
}

/**
 * Enforce entity-scoped authorization for the close-balance route (issue #6).
 *
 * ENTRY role may only close balances belonging to their own entity.
 * ADMIN and HQ_FINANCE may close any entity's balance.
 * Throws EntityAccessError (403) on violation.
 */
export function assertEntityAccess(
  callerRole:     string,
  callerEntityId: string | null,
  balanceEntityId: string,
): void {
  if (callerRole === 'ENTRY' && callerEntityId !== balanceEntityId) {
    throw new EntityAccessError(
      403,
      'Forbidden — you may only close balances for your own clinic',
    )
  }
}
