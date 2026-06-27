export interface EntityRow {
  id:            string
  code:          string
  name:          string
  go_live_month: string | null
}

export interface OverrideRow {
  id:          string
  entity_id:   string
  gated_month: string
  granted_by:  string
  granted_at:  string   // ISO timestamp string
  note:        string | null
  entity_name: string   // joined from entities
}
