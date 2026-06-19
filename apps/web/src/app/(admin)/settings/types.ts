export interface Setting {
  key:         string
  value:       number
  description: string | null
}

export interface AssetClass {
  code:              string
  name:              string
  useful_life_years: number
  annual_rate:       number   // fraction stored in DB, e.g. 0.1000 = 10.00%
  residual_rate:     number
  active:            boolean
}

// Human-readable labels and validation for each scalar setting
export const SETTING_META: Record<string, { label: string; description: string; validate: (v: number) => string | null; provisional?: boolean }> = {
  capitalisation_threshold: {
    label:       'Capitalisation threshold (BDT)',
    description: 'Minimum cost to capitalise vs expense. Items below this are treated as expenses.',
    validate:    v => (Number.isInteger(v) && v > 0) ? null : 'Must be a positive whole number.',
  },
  fiscal_year_start_month: {
    label:       'Fiscal year start month',
    description: 'Month the fiscal year begins (1 = January, 7 = July).',
    validate:    v => (Number.isInteger(v) && v >= 1 && v <= 12) ? null : 'Must be a whole number between 1 and 12.',
    provisional: true,
  },
  high_value_approval_threshold: {
    label:       'High-value approval threshold (BDT)',
    description: 'Journal entry total above which maker-checker approval is required.',
    validate:    v => (Number.isInteger(v) && v > 0) ? null : 'Must be a positive whole number.',
    provisional: true,
  },
}
