export const PARTY_KINDS = ['VENDOR', 'DEBTOR', 'INSTRUMENT', 'COUNTERPARTY'] as const
export type PartyKind = typeof PARTY_KINDS[number]

export interface Party {
  id:              string
  name:            string
  kind:            PartyKind
  control_account: string | null
  contact:         string | null
  active:          boolean
  created_by:      string
  created_at:      string
  updated_by:      string | null
  updated_at:      string | null
}

export interface ControlAccount {
  code: string
  name: string
}
