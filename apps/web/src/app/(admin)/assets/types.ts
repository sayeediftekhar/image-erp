export interface FixedAsset {
  id:                       string
  entity_id:                string
  name:                     string
  asset_class:              string   // FK → asset_classes.code
  purchase_date:            string   // ISO "YYYY-MM-DD"
  cost:                     number
  accumulated_depreciation: number   // READ-ONLY — Phase 4 run only
  active:                   boolean
  created_by:               string
  created_at:               string
  updated_by:               string | null
  updated_at:               string | null
}

export interface Entity {
  id:   string
  code: string
  name: string
}

export interface AssetClassOption {
  code: string
  name: string
}
