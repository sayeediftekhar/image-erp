import { createClient } from '@/lib/supabase/server'
import AccountsClient from './AccountsClient'
import type { Account } from './types'

export const metadata = { title: 'Accounts — IMAGE ERP' }

export default async function AccountsPage() {
  const supabase = createClient()
  const { data } = await supabase
    .from('accounts')
    .select('*')
    .order('code')

  return <AccountsClient initialAccounts={(data ?? []) as Account[]} />
}
