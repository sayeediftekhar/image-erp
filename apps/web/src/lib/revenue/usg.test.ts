import { filterUsgEntries, type UsgEntry } from './draft-merge'

describe('filterUsgEntries', () => {
  it('excludes entries where both count=0 and revenue=0', () => {
    const entries: UsgEntry[] = [
      { type: 'PP',    count: 0, revenue: 0 },
      { type: 'LOWER', count: 2, revenue: 300 },
    ]
    expect(filterUsgEntries(entries)).toEqual([{ type: 'LOWER', count: 2, revenue: 300 }])
  })

  it('retains entries where count > 0 even if revenue = 0', () => {
    const entries: UsgEntry[] = [{ type: 'PP', count: 3, revenue: 0 }]
    const result = filterUsgEntries(entries)
    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(3)
  })

  it('retains entries where revenue > 0 even if count = 0', () => {
    const entries: UsgEntry[] = [{ type: 'WHOLE', count: 0, revenue: 500 }]
    const result = filterUsgEntries(entries)
    expect(result).toHaveLength(1)
    expect(result[0].revenue).toBe(500)
  })

  it('returns empty array when all entries are zeros', () => {
    const entries: UsgEntry[] = [
      { type: 'PP',      count: 0, revenue: 0 },
      { type: 'LOWER',   count: 0, revenue: 0 },
      { type: 'WHOLE',   count: 0, revenue: 0 },
      { type: 'ANOMALY', count: 0, revenue: 0 },
    ]
    expect(filterUsgEntries(entries)).toHaveLength(0)
  })

  it('preserves the type field on retained entries', () => {
    const entries: UsgEntry[] = [
      { type: 'ANOMALY', count: 1, revenue: 1500 },
      { type: 'PP',      count: 0, revenue: 0 },
    ]
    const result = filterUsgEntries(entries)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('ANOMALY')
  })
})
