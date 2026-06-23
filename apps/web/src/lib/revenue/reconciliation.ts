// computeDraftIncome / computeDraftFundSplit mirror buildIncomeInput in
// packages/posting-engine/src/revenue.service.ts. The paisa-integer rounding
// MUST stay in sync with the engine — the Review screen total must equal what
// submitRevenueDay stores as total_revenue, exactly.
// Any change to buildIncomeInput requires a matching change here.

function safeNum(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

interface Amounts {
  amt4010: number; amt4020: number; amt4040: number; amt4050: number; amt4090: number
  amt4110: number; amt4120: number; amt4130: number
}

function accumulateAmounts(draft: Record<string, unknown>): Amounts {
  let amt4010 = 0, amt4020 = 0, amt4040 = 0, amt4050 = 0, amt4090 = 0
  let amt4110 = 0, amt4120 = 0, amt4130 = 0

  const sessions = (draft.sessions as Record<string, unknown> | undefined) ?? {}

  for (const key of ['MORNING', 'EVENING'] as const) {
    const s = sessions[key] as Record<string, unknown> | undefined
    if (s) {
      amt4010 += safeNum(s.service_charge)
      amt4110 += safeNum(s.rdf_medicine_sales)
      amt4120 += safeNum(s.lab_revenue)
      for (const u of (Array.isArray(s.usg) ? s.usg : []) as Array<Record<string, unknown>>)
        amt4050 += safeNum(u.revenue)
    }
  }

  const ah = sessions.AFTERHOURS as Record<string, unknown> | undefined
  if (ah) {
    amt4010 += safeNum(ah.service_charge)
    amt4110 += safeNum(ah.rdf_medicine_sales)
    amt4130 += safeNum(ah.logistic_sales)
  }

  for (const team of (Array.isArray(draft.satellite_teams) ? draft.satellite_teams : []) as Array<Record<string, unknown>>) {
    amt4040 += safeNum(team.service_charge)
    amt4110 += safeNum(team.rdf_medicine_sales)
    amt4120 += safeNum(team.lab_revenue)
    for (const u of (Array.isArray(team.usg) ? team.usg : []) as Array<Record<string, unknown>>)
      amt4050 += safeNum(u.revenue)
  }

  const delivery = (draft.delivery as Record<string, unknown> | undefined) ?? {}
  const nvd = delivery.nvd as Record<string, unknown> | undefined
  if (nvd) {
    amt4020 += safeNum(nvd.service_charge)
    amt4110 += safeNum(nvd.rdf_revenue)
    amt4130 += safeNum(nvd.logistic_revenue)
  }

  for (const item of (Array.isArray(draft.other_income) ? draft.other_income : []) as Array<Record<string, unknown>>)
    amt4090 += safeNum(item.amount)

  return { amt4010, amt4020, amt4040, amt4050, amt4090, amt4110, amt4120, amt4130 }
}

export interface FundSplit {
  total: number
  pi:    number
  rdf:   number
}

export function computeDraftFundSplit(draft: Record<string, unknown>): FundSplit {
  const { amt4010, amt4020, amt4040, amt4050, amt4090, amt4110, amt4120, amt4130 } =
    accumulateAmounts(draft)
  const pi  = amt4010 + amt4020 + amt4040 + amt4050 + amt4090
  const rdf = amt4110 + amt4120 + amt4130
  const totalPaisa = Math.round(pi * 100) + Math.round(rdf * 100)
  return {
    total: totalPaisa / 100,
    pi:    Math.round(pi  * 100) / 100,
    rdf:   Math.round(rdf * 100) / 100,
  }
}

export function computeDraftIncome(draft: Record<string, unknown>): number {
  return computeDraftFundSplit(draft).total
}

export function computeAdvancesReceived(draft: Record<string, unknown>): number {
  const delivery = (draft.delivery as Record<string, unknown> | undefined) ?? {}
  const csection = delivery.csection as Record<string, unknown> | undefined
  if (!csection) return 0
  const balances = Array.isArray(csection.balances)
    ? (csection.balances as Array<Record<string, unknown>>)
    : []
  return balances.reduce((s, b) => s + safeNum(b.advance), 0)
}

export interface ReconciliationArgs {
  openingCash:       number
  income:            number
  advancesReceived:  number
  deposit:           number
  cashAdvance:       number
  cashInHandCounted: number
}

export interface ReconciliationResult {
  expectedClosing: number
  delta:           number   // expectedClosing - cashInHandCounted; positive = manager has less than expected
  matched:         boolean  // Math.round(delta * 100) === 0
}

export function computeReconciliation(args: ReconciliationArgs): ReconciliationResult {
  const expectedClosing =
    args.openingCash + args.income + args.advancesReceived - args.deposit - args.cashAdvance
  const delta = expectedClosing - args.cashInHandCounted
  return {
    expectedClosing,
    delta,
    matched: Math.round(delta * 100) === 0,
  }
}
