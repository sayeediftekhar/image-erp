import { CHANNEL, getChannelDescriptors } from './channels'
import { getEntityCapabilities } from '../capabilities'

describe('CHANNEL constants', () => {
  it('has exactly 5 tokens', () => {
    expect(Object.keys(CHANNEL)).toHaveLength(5)
  })

  it('all values are non-empty strings', () => {
    for (const val of Object.values(CHANNEL)) {
      expect(typeof val).toBe('string')
      expect(val.length).toBeGreaterThan(0)
    }
  })

  it('includes the canonical vocabulary', () => {
    expect(CHANNEL.MORNING).toBe('MORNING')
    expect(CHANNEL.EVENING).toBe('EVENING')
    expect(CHANNEL.AFTERHOURS).toBe('AFTERHOURS')
    expect(CHANNEL.SATELLITE).toBe('SATELLITE')
    expect(CHANNEL.DELIVERY).toBe('DELIVERY')
  })
})

describe('getChannelDescriptors', () => {
  it('JAL → 5 descriptors, all tokens present', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('JAL'))
    const tokens = desc.map(d => d.token)
    expect(desc).toHaveLength(5)
    expect(tokens).toContain('MORNING')
    expect(tokens).toContain('EVENING')
    expect(tokens).toContain('AFTERHOURS')
    expect(tokens).toContain('SATELLITE')
    expect(tokens).toContain('DELIVERY')
  })

  it('NAS → 5 descriptors (same as JAL)', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('NAS'))
    expect(desc).toHaveLength(5)
    expect(desc.map(d => d.token)).toContain('DELIVERY')
  })

  it('CHA → 2 descriptors: MORNING + SATELLITE only', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('CHA'))
    const tokens = desc.map(d => d.token)
    expect(desc).toHaveLength(2)
    expect(tokens).toContain('MORNING')
    expect(tokens).toContain('SATELLITE')
    expect(tokens).not.toContain('EVENING')
    expect(tokens).not.toContain('AFTERHOURS')
    expect(tokens).not.toContain('DELIVERY')
  })

  it('AMB → DELIVERY included (nvd=true)', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('AMB'))
    const tokens = desc.map(d => d.token)
    expect(tokens).toContain('DELIVERY')
    expect(tokens).toContain('SATELLITE')
    expect(desc).toHaveLength(5)
  })

  it('KAT → DELIVERY included (nvd=true, csection=false)', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('KAT'))
    const tokens = desc.map(d => d.token)
    expect(tokens).toContain('DELIVERY')
    expect(tokens).toContain('SATELLITE')
  })

  it('CHA → no DELIVERY descriptor (nvd=false, csection=false)', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('CHA'))
    expect(desc.map(d => d.token)).not.toContain('DELIVERY')
  })

  it('DELIVERY descriptor has phase T3d', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('JAL'))
    const delivery = desc.find(d => d.token === 'DELIVERY')
    expect(delivery?.phase).toBe('T3d')
  })

  it('session channels (MORNING/EVENING/AFTERHOURS/SATELLITE) have phase T3c', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('JAL'))
    for (const d of desc) {
      if (d.token !== 'DELIVERY') {
        expect(d.phase).toBe('T3c')
      }
    }
  })

  it('all descriptors carry a label string', () => {
    const desc = getChannelDescriptors(getEntityCapabilities('JAL'))
    for (const d of desc) {
      expect(typeof d.label).toBe('string')
      expect(d.label.length).toBeGreaterThan(0)
    }
  })
})
