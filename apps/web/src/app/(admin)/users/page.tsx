import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import UsersClient from './UsersClient'
import type { AppUser, EntityOption } from './types'

export default async function UsersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: users }, { data: entities }] = await Promise.all([
    supabase.from('app_users').select('*').order('full_name'),
    supabase.from('entities').select('id, code, name').order('code'),
  ])

  return (
    <UsersClient
      initialUsers={(users ?? []) as AppUser[]}
      entities={(entities ?? []) as EntityOption[]}
      currentUserId={user.id}
    />
  )
}
