export const APP_ROLES = ['ADMIN', 'HQ_FINANCE', 'ENTRY', 'READ_ONLY'] as const
export type AppRole = typeof APP_ROLES[number]

export interface AppUser {
  id:         string
  full_name:  string | null
  role:       AppRole
  entity_id:  string | null
  active:     boolean
  created_at: string
}

export interface EntityOption {
  id:   string
  code: string
  name: string
}
