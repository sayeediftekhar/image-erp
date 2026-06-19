import { createClient } from '@/lib/supabase/server'
import PartiesClient from './PartiesClient'
import type { Party, ControlAccount } from './types'

export default async function PartiesPage() {
  const supabase = createClient()

  const [{ data: parties }, { data: controlAccounts }] = await Promise.all([
    supabase.from('parties').select('*').order('name'),
    supabase.from('accounts').select('code, name').eq('is_control', true).order('code'),
  ])

  return (
    <PartiesClient
      initialParties={(parties ?? []) as Party[]}
      controlAccounts={(controlAccounts ?? []) as ControlAccount[]}
    />
  )
}
