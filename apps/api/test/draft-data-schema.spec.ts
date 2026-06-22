import { OutdoorSessionSchema, AfterhoursSessionSchema, CsectionSchema } from '../src/revenue/draft-data.schema';

// ── No-C-section-income guard ─────────────────────────────────────────────────
// These tests guard against the old cash-basis model creeping back into the
// daily-entry schemas. Per the P2-T2b reconciliation: C-section income (4030,
// 4110, 4130) is recognised at DISCHARGE via closeDeliveryBalance — NOT at daily
// entry. The daily-entry C-section schema must capture only cases + advance records.

describe('CsectionSchema — admission-day shape has no income fields', () => {
  it('has exactly two keys: cases and balances', () => {
    const keys = Object.keys(CsectionSchema.shape)
    expect(keys).toHaveLength(2)
    expect(keys).toContain('cases')
    expect(keys).toContain('balances')
  })

  it('does not contain service_charge', () => {
    expect(Object.keys(CsectionSchema.shape)).not.toContain('service_charge')
  })

  it('does not contain rdf_revenue or logistic_revenue', () => {
    const keys = Object.keys(CsectionSchema.shape)
    expect(keys).not.toContain('rdf_revenue')
    expect(keys).not.toContain('logistic_revenue')
  })
})

describe('OutdoorSessionSchema — no C-section or delivery fields', () => {
  it('has the expected eight outdoor fields and no others', () => {
    const keys = Object.keys(OutdoorSessionSchema.shape)
    const expected = ['patients_new', 'patients_old', 'services', 'service_charge', 'rdf_medicine_sales', 'lab_tests', 'lab_revenue', 'usg']
    expect(keys.sort()).toEqual(expected.sort())
  })

  it('does not contain any csection or delivery key', () => {
    const keys = Object.keys(OutdoorSessionSchema.shape)
    const forbidden = ['csection_cases', 'csection_advance', 'delivery', 'nvd', 'safe_delivery']
    forbidden.forEach(f => expect(keys).not.toContain(f))
  })
})

describe('AfterhoursSessionSchema — no C-section, no lab, no USG', () => {
  it('has exactly four fields: patients, service_charge, rdf_medicine_sales, logistic_sales', () => {
    const keys = Object.keys(AfterhoursSessionSchema.shape)
    expect(keys).toHaveLength(4)
    expect(keys).toContain('patients')
    expect(keys).toContain('service_charge')
    expect(keys).toContain('rdf_medicine_sales')
    expect(keys).toContain('logistic_sales')
  })

  it('does not contain usg, lab_tests, or any csection field', () => {
    const keys = Object.keys(AfterhoursSessionSchema.shape)
    const forbidden = ['usg', 'lab_tests', 'lab_revenue', 'csection_cases', 'patients_new', 'patients_old']
    forbidden.forEach(f => expect(keys).not.toContain(f))
  })
})
