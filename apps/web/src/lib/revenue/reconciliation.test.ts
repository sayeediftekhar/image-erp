import {
  computeDraftIncome,
  computeDraftFundSplit,
  computeAdvancesReceived,
  computeReconciliation,
} from './reconciliation'

const EMPTY_DRAFT: Record<string, unknown> = {
  sessions: {},
  satellite_teams: [],
  delivery: {},
  other_income: [],
}

// ── computeDraftIncome ────────────────────────────────────────────────────────

describe('computeDraftIncome', () => {
  it('returns 0 for empty draft', () => {
    expect(computeDraftIncome(EMPTY_DRAFT)).toBe(0)
  })

  it('handles partial/missing fields gracefully (mid-wizard draft)', () => {
    expect(computeDraftIncome({ channels_active: ['MORNING'] })).toBe(0)
    expect(computeDraftIncome({})).toBe(0)
  })

  it('sums morning service_charge + NVD service_charge', () => {
    const draft: Record<string, unknown> = {
      sessions: {
        MORNING: { service_charge: 500, rdf_medicine_sales: 0, lab_revenue: 0, usg: [] },
      },
      satellite_teams: [],
      delivery: { nvd: { service_charge: 1000, rdf_revenue: 0, logistic_revenue: 0 } },
      other_income: [],
    }
    expect(computeDraftIncome(draft)).toBe(1500)
  })

  it('mirrors buildIncomeInput: all income streams summed (sessions + sat + nvd + other)', () => {
    const draft: Record<string, unknown> = {
      sessions: {
        MORNING:    { service_charge: 1000, rdf_medicine_sales: 200, lab_revenue: 300, usg: [{ type: 'PP', count: 1, revenue: 150 }] },
        EVENING:    { service_charge: 800,  rdf_medicine_sales: 100, lab_revenue: 0,   usg: [] },
        AFTERHOURS: { service_charge: 300,  rdf_medicine_sales: 50,  logistic_sales: 80 },
      },
      satellite_teams: [
        { team: 'TEAM_1', service_charge: 500, rdf_medicine_sales: 75, lab_revenue: 100,
          usg: [{ type: 'LOWER', count: 1, revenue: 200 }] },
      ],
      delivery: {
        nvd: { service_charge: 400, rdf_revenue: 60, logistic_revenue: 40 },
      },
      other_income: [{ description: 'misc', amount: 90 }],
    }
    // PI: 4010=(1000+800+300)=2100, 4020=400, 4040=500, 4050=(150+200)=350, 4090=90  → 3440
    // RDF: 4110=(200+100+50+75+60)=485, 4120=(300+100)=400, 4130=(80+40)=120        → 1005
    // totalPaisa = Math.round(3440*100) + Math.round(1005*100) = 344000+100500 = 444500
    // total = 4445
    expect(computeDraftIncome(draft)).toBe(4445)
  })

  it('uses paisa-integer rounding to avoid float drift', () => {
    // 0.1 + 0.2 in IEEE 754 = 0.30000000000000004
    const draft: Record<string, unknown> = {
      sessions: {
        MORNING: { service_charge: 0.1, rdf_medicine_sales: 0, lab_revenue: 0, usg: [] },
        EVENING: { service_charge: 0.2, rdf_medicine_sales: 0, lab_revenue: 0, usg: [] },
      },
      satellite_teams: [],
      delivery: {},
      other_income: [],
    }
    // piCash = 0.1 + 0.2 (float drift) → Math.round(drift * 100) = 30 → 0.3
    expect(computeDraftIncome(draft)).toBe(0.3)
    // Prove the raw float would differ
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  it('C-section has no income effect (advance is NOT income)', () => {
    const draft: Record<string, unknown> = {
      sessions: {},
      satellite_teams: [],
      delivery: {
        csection: { cases: 2, balances: [
          { patient_name: 'A', advance: 5000 },
          { patient_name: 'B', advance: 3000 },
        ] },
      },
      other_income: [],
    }
    // C-section advance is NOT income — income must be 0
    expect(computeDraftIncome(draft)).toBe(0)
  })
})

// ── computeDraftFundSplit ─────────────────────────────────────────────────────

describe('computeDraftFundSplit', () => {
  it('correctly splits PI and RDF totals', () => {
    const draft: Record<string, unknown> = {
      sessions: {
        MORNING: { service_charge: 1000, rdf_medicine_sales: 200, lab_revenue: 300, usg: [] },
      },
      satellite_teams: [],
      delivery: {},
      other_income: [],
    }
    const { pi, rdf, total } = computeDraftFundSplit(draft)
    expect(pi).toBe(1000)
    expect(rdf).toBe(500)   // 200 + 300
    expect(total).toBe(1500)
  })

  it('total = pi + rdf', () => {
    const draft: Record<string, unknown> = {
      sessions: {
        MORNING: { service_charge: 700, rdf_medicine_sales: 150, lab_revenue: 250, usg: [] },
      },
      satellite_teams: [],
      delivery: {},
      other_income: [],
    }
    const { pi, rdf, total } = computeDraftFundSplit(draft)
    expect(total).toBe(pi + rdf)
  })
})

// ── computeAdvancesReceived ───────────────────────────────────────────────────

describe('computeAdvancesReceived', () => {
  it('returns 0 when no delivery at all', () => {
    expect(computeAdvancesReceived(EMPTY_DRAFT)).toBe(0)
  })

  it('returns 0 when csection has empty balances', () => {
    const draft = { delivery: { csection: { cases: 0, balances: [] } } }
    expect(computeAdvancesReceived(draft as Record<string, unknown>)).toBe(0)
  })

  it('sums all C-section advance amounts', () => {
    const draft = {
      delivery: {
        csection: {
          cases: 2,
          balances: [
            { patient_name: 'Fatema', advance: 5000, expected_balance: 0 },
            { patient_name: 'Rina',   advance: 3000, expected_balance: 0 },
          ],
        },
      },
    }
    expect(computeAdvancesReceived(draft as Record<string, unknown>)).toBe(8000)
  })

  it('returns 0 when delivery has only nvd (no csection)', () => {
    const draft = {
      delivery: { nvd: { cases: 1, service_charge: 1000, rdf_revenue: 0, logistic_revenue: 0 } },
    }
    expect(computeAdvancesReceived(draft as Record<string, unknown>)).toBe(0)
  })
})

// ── computeReconciliation ─────────────────────────────────────────────────────

describe('computeReconciliation', () => {
  it('correct C-section day: advance included → matched=true', () => {
    // opening=5000, income=3000, advance=2000, deposit=0, cashAdv=0, counted=10000
    // expected = 5000+3000+2000-0-0 = 10000, delta=0
    const result = computeReconciliation({
      openingCash: 5000, income: 3000, advancesReceived: 2000,
      deposit: 0, cashAdvance: 0, cashInHandCounted: 10000,
    })
    expect(result.expectedClosing).toBe(10000)
    expect(result.delta).toBe(0)
    expect(result.matched).toBe(true)
  })

  it('omitting advance term mis-flags a correct C-section day (proves the term matters)', () => {
    // Same day as above but advancesReceived=0:
    // expected = 5000+3000+0-0-0 = 8000, counted=10000, delta=-2000 → ⚠
    const result = computeReconciliation({
      openingCash: 5000, income: 3000, advancesReceived: 0,
      deposit: 0, cashAdvance: 0, cashInHandCounted: 10000,
    })
    expect(result.expectedClosing).toBe(8000)
    expect(result.delta).toBe(-2000)
    expect(result.matched).toBe(false)
  })

  it('deposit and cash advance reduce expected closing', () => {
    // opening=10000, income=5000, advance=0, deposit=3000, cashAdv=500, counted=11500
    // expected = 10000+5000-3000-500 = 11500, delta=0
    const result = computeReconciliation({
      openingCash: 10000, income: 5000, advancesReceived: 0,
      deposit: 3000, cashAdvance: 500, cashInHandCounted: 11500,
    })
    expect(result.expectedClosing).toBe(11500)
    expect(result.delta).toBe(0)
    expect(result.matched).toBe(true)
  })

  it('manager count is short: delta > 0, matched=false', () => {
    // expected=1000, counted=900 → delta=100 (expected more than counted)
    const result = computeReconciliation({
      openingCash: 0, income: 1000, advancesReceived: 0,
      deposit: 0, cashAdvance: 0, cashInHandCounted: 900,
    })
    expect(result.expectedClosing).toBe(1000)
    expect(result.delta).toBe(100)
    expect(result.matched).toBe(false)
  })

  it('manager count is over: delta < 0, matched=false', () => {
    const result = computeReconciliation({
      openingCash: 0, income: 1000, advancesReceived: 0,
      deposit: 0, cashAdvance: 0, cashInHandCounted: 1050,
    })
    expect(result.delta).toBe(-50)
    expect(result.matched).toBe(false)
  })

  it('zero-income day with opening cash: reconciles correctly', () => {
    const result = computeReconciliation({
      openingCash: 5000, income: 0, advancesReceived: 0,
      deposit: 0, cashAdvance: 0, cashInHandCounted: 5000,
    })
    expect(result.matched).toBe(true)
  })
})
