// Single source for per-clinic service capabilities.
// Consumed by: ManagerShell nav adaptation, Home dashboard, T3b wizard steps.
// Authoritative reference: docs/reference/clinic_service_matrix.md

export interface EntityCapabilities {
  sessions: {
    morning:    boolean
    evening:    boolean
    afterhours: boolean
  }
  satellite:  boolean
  delivery: {
    nvd:      boolean
    csection: boolean
  }
}

const MATRIX: Record<string, EntityCapabilities> = {
  JAL: { sessions: { morning: true,  evening: true,  afterhours: true  }, satellite: true,  delivery: { nvd: true,  csection: true  } },
  NAS: { sessions: { morning: true,  evening: true,  afterhours: true  }, satellite: true,  delivery: { nvd: true,  csection: true  } },
  AMB: { sessions: { morning: true,  evening: true,  afterhours: true  }, satellite: true,  delivery: { nvd: true,  csection: false } },
  KAT: { sessions: { morning: true,  evening: true,  afterhours: true  }, satellite: false, delivery: { nvd: true,  csection: false } },
  CHA: { sessions: { morning: true,  evening: false, afterhours: false }, satellite: true,  delivery: { nvd: false, csection: false } },
}

export function getEntityCapabilities(code: string): EntityCapabilities {
  const caps = MATRIX[code]
  if (!caps) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`Unknown entity code "${code}"; defaulting to JAL capabilities`)
    }
    return MATRIX['JAL']
  }
  return caps
}

// Deliveries nav item + overdue-balance dashboard widget are visible only for clinics
// with C-section tracking. NVD-only clinics (AMB/KAT) have no delivery_balance rows
// (NVD is same-day income, no advance held), so Deliveries would be structurally empty.
export function hasDeliveries(caps: EntityCapabilities): boolean {
  return caps.delivery.csection
}
