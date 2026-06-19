export const ACCOUNT_TYPES    = ['ASSET', 'LIABILITY', 'FUND', 'INCOME', 'EXPENSE'] as const
export const NORMAL_BALANCES  = ['DEBIT', 'CREDIT'] as const
export const FUNDS            = ['PI', 'RDF', 'HQ', 'TB_CARE'] as const

export type AccountType    = typeof ACCOUNT_TYPES[number]
export type NormalBalance  = typeof NORMAL_BALANCES[number]
export type Fund           = typeof FUNDS[number]

export interface Account {
  code:              string
  name:              string
  type:              AccountType
  normal_balance:    NormalBalance
  fund:              Fund | null
  is_control:        boolean
  requires_approval: boolean
  active:            boolean
  created_by:        string
  created_at:        string
  updated_by:        string | null
  updated_at:        string | null
}
