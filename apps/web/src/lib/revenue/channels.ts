import type { EntityCapabilities } from '../capabilities'

export const CHANNEL = {
  MORNING:    'MORNING',
  EVENING:    'EVENING',
  AFTERHOURS: 'AFTERHOURS',
  SATELLITE:  'SATELLITE',
  DELIVERY:   'DELIVERY',
} as const

export type Channel = typeof CHANNEL[keyof typeof CHANNEL]

export interface ChannelDescriptor {
  token: Channel
  label: string
  phase: 'T3c' | 'T3d'
}

// Returns only the channel descriptors applicable to the given entity's capabilities.
// CHA → [MORNING, SATELLITE]; JAL/NAS → all 5; AMB/KAT → all 5 (nvd=true → DELIVERY).
export function getChannelDescriptors(caps: EntityCapabilities): ChannelDescriptor[] {
  const result: ChannelDescriptor[] = []
  if (caps.sessions.morning)
    result.push({ token: 'MORNING',    label: 'Morning clinic',  phase: 'T3c' })
  if (caps.sessions.evening)
    result.push({ token: 'EVENING',    label: 'Evening clinic',  phase: 'T3c' })
  if (caps.sessions.afterhours)
    result.push({ token: 'AFTERHOURS', label: 'After-hours',     phase: 'T3c' })
  if (caps.satellite)
    result.push({ token: 'SATELLITE',  label: 'Satellite teams', phase: 'T3c' })
  if (caps.delivery.nvd || caps.delivery.csection)
    result.push({ token: 'DELIVERY',   label: 'Deliveries',      phase: 'T3d' })
  return result
}
